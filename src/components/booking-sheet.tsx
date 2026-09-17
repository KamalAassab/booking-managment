"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { DialogState } from "@/components/bookings-board";
import { ClientCombobox } from "@/components/client-combobox";
import {
  Calendar as CalendarIcon,
  Check,
  Close,
  Plus,
  RotateCcw,
  WhatsApp,
} from "@/components/icons";
import { Calendar } from "@/components/ui/calendar";
import { SelectDropdown } from "@/components/ui/select";
import type { ToastMessage } from "@/components/toast";
import { formatDuration, slotAvailability, type SlotAvailability } from "@/lib/day-layout";
import { formatPhoneForDisplay, normalizePhone } from "@/lib/phone";
import {
  findCatalogEntry,
  groupCatalog,
  type ServiceCatalogEntry,
} from "@/lib/services-catalog";
import {
  addDays,
  conflictsWithExisting,
  formatDayTitle,
  formatShortDate,
  isValidDateString,
  minutesToLabel,
  nowMinutesInSalonTz,
  slotsForSalon,
} from "@/lib/time";
import type { BookingDTO, BookingServiceDTO, SalonDTO } from "@/lib/types";
import { DURATION_OPTIONS, MAX_SERVICES_PER_BOOKING } from "@/lib/validation";
import { buildWhatsAppLink } from "@/lib/whatsapp";

const CUSTOM_SERVICE = "Autre";
const SLOT_TAKEN = "Ce créneau vient d'être réservé sur un autre poste.";
/** How long "Confirmer l'annulation" waits for its second tap. */
const CONFIRM_MS = 4000;

/** One line of the sheet's service list — the form's own shape, not the wire one. */
type ServiceEntry = {
  key: string;
  /** A catalogue name, or CUSTOM_SERVICE with the real name in `customService`. */
  service: string;
  customService: string;
  durationMin: number;
  price: number | "";
};

let entryKeySeed = 0;
function nextEntryKey(): string {
  entryKeySeed += 1;
  return `entry-${entryKeySeed}`;
}

/** A fresh, empty line — a new booking, or "+ Ajouter un service", both start blank. */
function emptyEntry(durationMin: number): ServiceEntry {
  return { key: nextEntryKey(), service: "", customService: "", durationMin, price: "" };
}

/** A booking's saved lines, resolved against the catalogue so real services keep their duration/price editable. */
function entriesFromServices(
  services: readonly BookingServiceDTO[],
  catalog: readonly ServiceCatalogEntry[],
): ServiceEntry[] {
  return services.map((s) => {
    const found = findCatalogEntry(catalog, s.service);
    return {
      key: nextEntryKey(),
      service: found ? found.name : CUSTOM_SERVICE,
      customService: found ? "" : s.service,
      durationMin: s.durationMin,
      price: s.price,
    };
  });
}

/** The usual duration choices, plus the current one if it's off the list — an owner-set duration must stay selectable. */
function durationOptionsFor(current: number): number[] {
  const options: number[] = [...DURATION_OPTIONS];
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

function sameServiceLines(
  a: readonly { service: string; durationMin: number }[],
  b: readonly { service: string; durationMin: number }[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (x, i) =>
      x.service.trim().toLowerCase() === b[i].service.trim().toLowerCase() &&
      x.durationMin === b[i].durationMin,
  );
}

type Props = {
  state: NonNullable<DialogState>;
  salon: SalonDTO;
  date: string;
  today: string;
  bookings: BookingDTO[];
  /** The salon's bookable services — the owner's live catalogue. */
  catalog: ServiceCatalogEntry[];
  onClose: () => void;
  /** A booking exactly as the server stored it, to show at once. */
  onSaved: (booking: BookingDTO, previousDate?: string) => void;
  /** Something changed that this screen may not know about: refresh it. */
  onChanged: () => void;
  onToast: (toast: ToastMessage) => void;
  onOptimisticStatus?: (
    bookingId: string,
    status: BookingDTO["status"],
  ) => {
    rollback: () => void;
    commit: (saved: BookingDTO) => void;
  };
};

const PERIODS: { label: string; from: number; to: number }[] = [
  { label: "Matin", from: 0, to: 12 * 60 },
  { label: "Après-midi", from: 12 * 60, to: 18 * 60 },
  { label: "Soir", from: 18 * 60, to: 24 * 60 },
];

/**
 * Create or edit a booking.
 *
 * A bottom sheet on a phone, a two-column panel from 768px: who and what on
 * the left, when on the right. The time is picked on a grid that already
 * knows, for the service chosen, which start times are free, taken or past,
 * computed from the day on screen with no request, so the agent sees the
 * answer while the client is still on the line.
 *
 * A save keeps the sheet open until the server has answered. A refusal
 * leaves the form as it was, with the reason, ready for another time: the
 * slot another agent just took is the collision this system exists to catch.
 */
export function BookingSheet({
  state,
  salon,
  date,
  today,
  bookings,
  catalog,
  onClose,
  onSaved,
  onChanged,
  onToast,
  onOptimisticStatus,
}: Props) {
  const editing = state.kind === "edit" ? state.booking : null;
  const router = useRouter();

  const groups = useMemo(() => groupCatalog(catalog), [catalog]);
  const catalogEntryFor = (name: string) => findCatalogEntry(catalog, name);

  const [clientName, setClientName] = useState(editing?.clientName ?? "");
  const [clientPhone, setClientPhone] = useState(
    editing ? formatPhoneForDisplay(editing.clientPhone) : "",
  );
  // A new booking starts with one empty line: the first entry of a
  // sixty-line catalogue is almost never the right one, and a wrong default
  // is saved silently.
  const [entries, setEntries] = useState<ServiceEntry[]>(() =>
    editing && editing.services.length > 0
      ? entriesFromServices(editing.services, catalog)
      : [emptyEntry(salon.slotMin)],
  );
  const [startMin, setStartMin] = useState(
    state.kind === "edit" ? state.booking.startMin : state.startMin,
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // A new booking's own date, independent of whatever day the board behind
  // the sheet has on screen: the "+Nouveau" action defaults it to today
  // (state.date), a click on a specific slot or day starts it there, and
  // this field lets the agent move it — to tomorrow, or any date — without
  // leaving the sheet. Editing never moves a booking's date here.
  const [bookingDate, setBookingDate] = useState(
    editing ? editing.bookingDate : state.kind === "create" ? state.date : date,
  );

  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // The board's `bookings` prop is only ever the day it currently has on
  // screen, live-polled every 750ms. When the picked date is that same day,
  // that feed is the freshest source there is; any other date fetches its
  // own snapshot once, just to draw a real time grid instead of applying one
  // day's bookings to another's.
  const [otherDayBookings, setOtherDayBookings] = useState<BookingDTO[] | null>(null);
  const needsOwnFetch = bookingDate !== date;
  useEffect(() => {
    if (!needsOwnFetch) return;
    let cancelled = false;
    setOtherDayBookings(null);
    fetch(`/api/bookings?salon=${encodeURIComponent(salon.slug)}&date=${encodeURIComponent(bookingDate)}`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { bookings?: BookingDTO[] } | null) => {
        if (!cancelled) setOtherDayBookings(data?.bookings ?? []);
      })
      .catch(() => {
        if (!cancelled) setOtherDayBookings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsOwnFetch, bookingDate, salon.slug]);
  const dayBookings = needsOwnFetch ? (otherDayBookings ?? []) : bookings;
  const dayBookingsLoading = needsOwnFetch && otherDayBookings === null;

  function updateEntry(key: string, patch: Partial<ServiceEntry>) {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));
    setError(null);
  }

  /** A real service pre-fills its standard duration and price; both stay editable. */
  function handleEntryServiceChange(key: string, name: string) {
    const found = catalogEntryFor(name);
    updateEntry(
      key,
      found ? { service: name, durationMin: found.durationMin, price: found.price } : { service: name, price: "" },
    );
  }

  function addEntry() {
    setEntries((prev) =>
      prev.length >= MAX_SERVICES_PER_BOOKING ? prev : [...prev, emptyEntry(salon.slotMin)],
    );
    setError(null);
  }

  function removeEntry(key: string) {
    setEntries((prev) => (prev.length > 1 ? prev.filter((e) => e.key !== key) : prev));
    setError(null);
  }

  function requestClose() {
    // Closing mid-save would hide the outcome of a booking that may already
    // exist; the sheet waits for the answer instead.
    if (!busy) onClose();
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // An open dropdown inside the sheet handles its own Escape and marks
      // the event; it must close the dropdown, not the booking.
      if (e.defaultPrevented) return;
      if (!busy) onClose();
      return;
    }
    // Focus stays inside while the sheet is open.
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]):not([tabindex="-1"]),input:not([disabled]):not([tabindex="-1"]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Once per opening: the board re-renders on every live update, and an
  // effect depending on its callbacks moved focus back to the name field
  // while a phone number was being typed.
  useEffect(() => {
    const returnFocusTo = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();

    const listener = (e: KeyboardEvent) => onKeyDown(e);
    document.addEventListener("keydown", listener);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", listener);
      document.body.style.overflow = previousOverflow;
      returnFocusTo?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (!confirmCancel) return;
    const timer = setTimeout(() => setConfirmCancel(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmCancel]);

  const nowMin = bookingDate === today ? nowMinutesInSalonTz() : null;
  const isPastDay = bookingDate < today;

  // Each entry resolved to the name it will actually be saved under, its own
  // duration, and its own price (blank means "not set", saved as 0).
  const resolvedEntries = useMemo(
    () =>
      entries.map((e) => ({
        service: (e.service === CUSTOM_SERVICE ? e.customService : e.service).trim(),
        durationMin: e.durationMin,
        price: e.price === "" ? 0 : e.price,
      })),
    [entries],
  );
  const totalDurationMin = resolvedEntries.reduce((sum, e) => sum + e.durationMin, 0);
  const totalPrice = resolvedEntries.reduce((sum, e) => sum + e.price, 0);
  const serviceLabel = resolvedEntries.map((e) => e.service).filter(Boolean).join(" + ");

  /** Every entry's own slice of the day, back to back from a candidate start. */
  function subSlots(fromMin: number) {
    let cursor = fromMin;
    return resolvedEntries.map((e) => {
      const slot = { service: e.service, startMin: cursor, durationMin: e.durationMin };
      cursor += e.durationMin;
      return slot;
    });
  }

  const slots = useMemo(() => {
    const grid = slotsForSalon(salon);
    // A booking can sit off today's grid (hours changed since it was made);
    // its own time must still be selectable.
    return editing && !grid.includes(editing.startMin)
      ? [...grid, editing.startMin].sort((a, b) => a - b)
      : grid;
  }, [salon, editing]);

  const availability = useMemo(
    () =>
      slotAvailability(
        salon,
        slots,
        { durationMin: totalDurationMin, service: serviceLabel },
        (s) =>
          subSlots(s).some(
            (slot) =>
              slot.service &&
              conflictsWithExisting(
                { startMin: slot.startMin, durationMin: slot.durationMin, service: slot.service },
                dayBookings,
                editing?.id,
              ),
          ),
        isPastDay ? 24 * 60 : nowMin,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salon, slots, totalDurationMin, resolvedEntries, dayBookings, editing?.id, isPastDay, nowMin],
  );

  const selected = availability.find((s) => s.startMin === startMin);
  const selectedState: SlotAvailability["state"] = selected?.state ?? "free";
  // An edit that leaves the time and services alone is never blocked by it:
  // the booking keeps the slot it already holds, even if the hours or the
  // clock have moved since. Only a new time, or new services at that time,
  // is checked.
  const timeChanged =
    !editing || startMin !== editing.startMin || totalDurationMin !== editing.durationMin;
  const servicesChanged = !editing || !sameServiceLines(resolvedEntries, editing.services);
  const blocksSubmit =
    (selectedState === "taken" && (timeChanged || servicesChanged)) ||
    (selectedState === "overflow" && timeChanged) ||
    (!editing && selectedState === "past") ||
    // A different day's availability is still on its way: the grid below is
    // showing every slot as free rather than that day's real state, so the
    // save waits rather than risk the agent confirming a slot that is taken.
    (!editing && dayBookingsLoading);
  const nextFree = availability.find((s) => s.state === "free" && s.startMin > startMin)
    ?? availability.find((s) => s.state === "free");

  const endMin = startMin + totalDurationMin;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    // Everything the server would refuse for a reason the agent can fix is
    // caught here, before a request, and before a WhatsApp tab, exists.
    if (clientName.trim().length < 2) {
      setError("Nom du client requis.");
      firstFieldRef.current?.focus();
      return;
    }
    const phone = normalizePhone(clientPhone);
    if (!phone.ok) {
      setError(phone.error);
      document.getElementById("clientPhone")?.focus();
      return;
    }
    const emptyIndex = resolvedEntries.findIndex((e) => !e.service);
    if (emptyIndex !== -1) {
      setError(
        entries[emptyIndex]?.service === CUSTOM_SERVICE
          ? "Précisez le service."
          : "Choisissez un service pour chaque ligne.",
      );
      return;
    }
    if (blocksSubmit) return;

    const creating = !editing;
    // Opened now, synchronously inside the submit, so popup blockers allow it;
    // it stays blank until the server has accepted the booking.
    const waTab = creating ? window.open("", "_blank") : null;
    setBusy(true);

    let res: Response;
    let data: { error?: string; booking?: BookingDTO };
    try {
      if (editing) {
        // Only what changed: re-sending an unchanged time re-checks it
        // against today's opening hours, which refused a note added to a
        // booking made before the hours changed.
        const patch: Record<string, unknown> = {
          clientName: clientName.trim(),
          clientPhone: phone.e164,
          services: resolvedEntries,
          notes,
        };
        if (startMin !== editing.startMin) patch.startMin = startMin;
        res = await fetch(`/api/bookings/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      } else {
        res = await fetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            salonSlug: salon.slug,
            clientName: clientName.trim(),
            clientPhone: phone.e164,
            bookingDate,
            startMin,
            services: resolvedEntries,
            notes,
            // Every booking comes through the call centre — the front-desk
            // "Réception" poste was removed (this salon has no reception).
            channel: "call_center",
          }),
        });
      }
      data = (await res.json().catch(() => ({}))) as typeof data;
    } catch {
      waTab?.close();
      setBusy(false);
      setError("Connexion perdue. Rien n'a été enregistré, réessayez.");
      return;
    }

    if (!res.ok || !data.booking) {
      waTab?.close();
      setBusy(false);
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      setError(
        data.error ??
          (res.status === 409 ? SLOT_TAKEN : "Enregistrement impossible. Réessayez."),
      );
      // Someone else's booking is why this failed: bring the day up to date
      // so the time grid marks the slot as taken.
      if (res.status === 409 || res.status === 404) onChanged();
      return;
    }

    const saved = data.booking;
    onSaved(saved, editing?.bookingDate);

    if (creating) {
      const confirmationUrl = buildWhatsAppLink({
        clientName: saved.clientName,
        clientPhone: saved.clientPhone,
        salonName: salon.name,
        salonSlug: salon.slug,
        bookingDate: saved.bookingDate,
        startMin: saved.startMin,
        services: saved.services,
        notes: saved.notes,
      });
      if (waTab && !waTab.closed) {
        waTab.location.href = confirmationUrl;
        onToast({
          tone: "success",
          text: "Rendez-vous enregistré. Envoyez le message dans l'onglet ouvert.",
        });
      } else {
        onToast({
          tone: "success",
          text: "Rendez-vous enregistré.",
          action: { label: "Ouvrir WhatsApp", href: confirmationUrl },
        });
      }
    } else {
      onToast({ tone: "success", text: "Rendez-vous mis à jour." });
    }
    onClose();
  }

  async function mutateStatus(status: "cancelled" | "done" | "confirmed") {
    if (!editing || busy) return;
    const opt = onOptimisticStatus?.(editing.id, status);
    onToast({
      tone: "success",
      text:
        status === "cancelled"
          ? "Rendez-vous annulé."
          : status === "done"
            ? "Rendez-vous marqué comme terminé."
            : "Rendez-vous rétabli.",
    });
    onClose();

    try {
      const res =
        status === "cancelled"
          ? await fetch(`/api/bookings/${editing.id}`, { method: "DELETE" })
          : await fetch(`/api/bookings/${editing.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status }),
            });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        booking?: BookingDTO;
      };
      if (!res.ok || !data.booking) {
        opt?.rollback();
        onToast({ tone: "error", text: data.error ?? "Erreur inattendue." });
        return;
      }
      opt?.commit(data.booking);
    } catch {
      opt?.rollback();
      onToast({ tone: "error", text: "Connexion perdue. Action annulée." });
    }
  }

  const manualWhatsApp = editing
    ? buildWhatsAppLink({
        clientName: editing.clientName,
        clientPhone: editing.clientPhone,
        salonName: salon.name,
        salonSlug: salon.slug,
        bookingDate: editing.bookingDate,
        startMin: editing.startMin,
        services: editing.services,
        notes: editing.notes,
      })
    : null;

  const summaryTime = `${minutesToLabel(startMin)} à ${minutesToLabel(endMin)}`;
  const summaryDetail = [
    formatDuration(totalDurationMin),
    totalPrice > 0 ? `${totalPrice} MAD` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="sheet-backdrop anim-fade md:items-center md:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        aria-busy={busy || undefined}
        className="anim-sheet flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-[20px] md:max-h-[min(860px,94dvh)] md:max-w-[900px] md:rounded-[20px]"
        style={{ background: "var(--surface)", boxShadow: "var(--shadow-sheet)" }}
      >
        <div className="flex justify-center pt-1.5 pb-0.5 md:hidden" aria-hidden>
          <span className="block h-1 w-9 rounded-full" style={{ background: "var(--line-strong)" }} />
        </div>

        <div className="flex items-center justify-between gap-3 border-b px-4 py-1.5 md:px-6 md:py-2" style={{ borderColor: "var(--line)" }}>
          <div className="min-w-0 flex-1">
            <h2 id="sheet-title" className="text-[17px] font-semibold tracking-tight leading-tight md:text-[18px]" style={{ fontFamily: "var(--font-display)" }}>
              {editing ? "Modifier le rendez-vous" : "Nouveau rendez-vous"}
            </h2>
          </div>
          {editing?.status === "done" ? (
            <span className="chip chip-success shrink-0 py-0.5 text-[12px]">
              <Check size={13} />
              Terminé
            </span>
          ) : null}
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            aria-label="Fermer"
            className="btn-icon -mr-1.5 h-8 w-8 min-h-[32px] md:h-8 md:w-8"
          >
            <Close size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <fieldset disabled={busy} className="contents">
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3.5 py-2.5 md:px-6 md:py-4">
              <div className="grid gap-3 md:grid-cols-2 md:gap-7">
                {/* ---- Left column: Client, Phone, Notes, Date, Start time ---- */}
                <div className="flex flex-col gap-2.5 md:gap-4">
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-1 md:gap-4">
                    <div>
                      <label className="label" htmlFor="client_name">
                        Nom du client
                      </label>
                      <ClientCombobox
                        inputRef={firstFieldRef}
                        value={clientName}
                        onChange={(value) => {
                          setClientName(value);
                          setError(null);
                        }}
                        onSelectClient={(client) => {
                          setClientName(client.name);
                          if (client.phone) setClientPhone(formatPhoneForDisplay(client.phone));
                          // A returning client usually books what they had
                          // last time — every one of their services, not
                          // just the first.
                          const stillEmpty = entries.every((e) => !e.service);
                          if (stillEmpty && client.services?.length) {
                            setEntries(
                              client.services.map((name) => {
                                const found = catalogEntryFor(name);
                                return found
                                  ? {
                                      key: nextEntryKey(),
                                      service: found.name,
                                      customService: "",
                                      durationMin: found.durationMin,
                                      price: found.price,
                                    }
                                  : {
                                      key: nextEntryKey(),
                                      service: CUSTOM_SERVICE,
                                      customService: name,
                                      durationMin: salon.slotMin,
                                      price: "",
                                    };
                              }),
                            );
                          }
                        }}
                        required
                      />
                    </div>

                    <div>
                      <label className="label" htmlFor="clientPhone">
                        Téléphone
                      </label>
                      <input
                        id="clientPhone"
                        className="field"
                        type="tel"
                        inputMode="tel"
                        value={clientPhone}
                        onChange={(e) => {
                          setClientPhone(e.target.value);
                          setError(null);
                        }}
                        required
                        placeholder="06 12 34 56 78"
                        autoComplete="off"
                      />
                    </div>
                  </div>

                  <NotesField notes={notes} onChange={setNotes} />

                  {!editing ? (
                    <div>
                      <span className="label" id="date-label">
                        Date
                      </span>
                      <DateField
                        value={bookingDate}
                        today={today}
                        onChange={(value) => {
                          setBookingDate(value);
                          setError(null);
                        }}
                      />
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="label mb-0" id="time-label">
                        Heure de début
                      </span>
                      {dayBookingsLoading ? (
                        <span className="t-small truncate" style={{ color: "var(--ink-faint)" }}>
                          Chargement du jour…
                        </span>
                      ) : serviceLabel ? (
                        <span className="t-small truncate" style={{ color: "var(--ink-faint)" }}>
                          Disponibilités pour {formatDuration(totalDurationMin)}
                        </span>
                      ) : null}
                    </div>

                    <TimeGrid
                      availability={availability}
                      value={startMin}
                      editing={Boolean(editing)}
                      onChange={(value) => {
                        setStartMin(value);
                        setError(null);
                      }}
                    />

                    {isPastDay && !editing ? (
                      <Advisory>Cette date est passée : il n&apos;est plus possible d&apos;y réserver.</Advisory>
                    ) : selectedState === "taken" && (timeChanged || servicesChanged) ? (
                      <Advisory tone="danger">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span>
                            {minutesToLabel(startMin)} chevauche déjà{" "}
                            {serviceLabel ? `« ${serviceLabel} »` : "un rendez-vous"}.
                          </span>
                          {nextFree ? (
                            <button
                              type="button"
                              className="font-semibold underline underline-offset-2"
                              onClick={() => setStartMin(nextFree.startMin)}
                            >
                              Prendre {minutesToLabel(nextFree.startMin)}
                            </button>
                          ) : null}
                        </span>
                      </Advisory>
                    ) : selectedState === "overflow" && timeChanged ? (
                      <Advisory tone="danger">
                        Se termine après la fermeture ({minutesToLabel(salon.closesAtMin)}). Choisissez une heure plus tôt ou une durée plus courte.
                      </Advisory>
                    ) : selectedState === "past" && !editing ? (
                      <Advisory tone="danger">Cette heure est déjà passée.</Advisory>
                    ) : null}
                  </div>
                </div>

                {/* ---- Right column: Services, Duration, Price, Add service ---- */}
                <div className="flex flex-col gap-2 md:gap-3">
                  {entries.map((entry, index) => (
                    <div
                      key={entry.key}
                      className="relative flex flex-col gap-2 rounded-[10px] border p-2 md:gap-3 md:rounded-[12px] md:p-3"
                      style={{ borderColor: "var(--line)", zIndex: entries.length - index }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label className="label mb-0" htmlFor={`service-${entry.key}`}>
                          {entries.length > 1 ? `Service ${index + 1}` : "Service"}
                        </label>
                        {entries.length > 1 ? (
                          <button
                            type="button"
                            className="btn-icon -mr-1 -mt-1 h-7 w-7"
                            onClick={() => removeEntry(entry.key)}
                            aria-label={`Retirer le service ${index + 1}`}
                          >
                            <Close size={15} />
                          </button>
                        ) : null}
                      </div>
                      <SelectDropdown<string>
                        id={`service-${entry.key}`}
                        value={entry.service}
                        onChange={(value) => handleEntryServiceChange(entry.key, value)}
                        placeholder="Choisir un service"
                        searchable
                        searchPlaceholder="Rechercher un service"
                        groups={groups
                          .map((group) => ({
                            category: group.category,
                            items: group.items.map((catalogEntry) => ({
                              value: catalogEntry.name,
                              label: catalogEntry.name,
                              description: `${formatDuration(catalogEntry.durationMin)} · ${catalogEntry.price} MAD`,
                            })),
                          }))
                          .concat([
                            {
                              category: "Autre",
                              items: [
                                {
                                  value: CUSTOM_SERVICE,
                                  label: CUSTOM_SERVICE,
                                  description: "Service hors catalogue",
                                },
                              ],
                            },
                          ])}
                      />

                      {entry.service === CUSTOM_SERVICE ? (
                        <input
                          className="field"
                          value={entry.customService}
                          onChange={(e) => updateEntry(entry.key, { customService: e.target.value })}
                          maxLength={120}
                          placeholder="Nom du service"
                          aria-label="Précisez le service"
                        />
                      ) : null}

                      <div className="grid grid-cols-2 gap-1.5 md:gap-3">
                        <div>
                          <label className="label" htmlFor={`durationMin-${entry.key}`}>
                            Durée
                          </label>
                          <SelectDropdown<number>
                            id={`durationMin-${entry.key}`}
                            value={entry.durationMin}
                            onChange={(value) => updateEntry(entry.key, { durationMin: value })}
                            options={durationOptionsFor(entry.durationMin).map((d) => ({
                              value: d,
                              label: formatDuration(d),
                            }))}
                          />
                        </div>
                        <div>
                          <label className="label" htmlFor={`price-${entry.key}`}>
                            Tarif
                          </label>
                          <div className="relative flex items-center">
                            <input
                              id={`price-${entry.key}`}
                              className="field pr-12"
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={1}
                              value={entry.price}
                              onChange={(e) =>
                                updateEntry(entry.key, {
                                  price: e.target.value === "" ? "" : Number(e.target.value),
                                })
                              }
                              placeholder="0"
                            />
                            <span
                              className="pointer-events-none absolute right-3 text-[13px] font-semibold"
                              style={{ color: "var(--ink-soft)" }}
                            >
                              MAD
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {entries.length < MAX_SERVICES_PER_BOOKING ? (
                    <button
                      type="button"
                      className="btn-secondary btn-sm self-start"
                      onClick={addEntry}
                    >
                      <Plus size={15} />
                      Ajouter un service
                    </button>
                  ) : null}
                </div>
              </div>

              {error ? (
                <p
                  role="alert"
                  className="t-small mt-3 rounded-[10px] px-2.5 py-2 md:mt-4 md:px-3 md:py-2.5"
                  style={{ background: "var(--danger-tint)", color: "var(--danger)" }}
                >
                  {error}
                </p>
              ) : null}
            </div>

            {/* Actions stay pinned, in the same place whether the form scrolls or not. */}
            <div
              className="border-t px-3.5 pt-2 md:px-6 md:py-4"
              style={{
                borderColor: "var(--line)",
                background: "var(--surface)",
                paddingBottom: "max(16px, env(safe-area-inset-bottom))",
              }}
            >
              <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:gap-3">
                <div className="min-w-0 md:flex-1">
                  <p className="truncate text-[14.5px] font-semibold" data-nums>
                    {summaryTime}
                    {serviceLabel ? <span style={{ color: "var(--ink-soft)" }}> · {serviceLabel}</span> : null}
                  </p>
                  <p className="t-small truncate" style={{ color: "var(--ink-faint)" }} data-nums>
                    {summaryDetail}
                  </p>
                </div>

                {/* Every action in one row, on a phone too — the save button
                    used to claim its own row above the rest, which read as
                    two decisions when it is one. */}
                <div className="flex items-center gap-1 md:flex-nowrap md:gap-3">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        className={`btn-danger order-2 min-w-0 flex-1 px-1.5 text-[13px] md:order-none md:flex-none md:px-3 md:text-[15px] ${confirmCancel ? "btn-confirm" : ""}`}
                        onClick={() => (confirmCancel ? mutateStatus("cancelled") : setConfirmCancel(true))}
                        aria-label={confirmCancel ? "Confirmer l'annulation" : "Annuler le rendez-vous"}
                      >
                        <span className="truncate md:hidden">{confirmCancel ? "Confirmer" : "Annuler"}</span>
                        <span className="hidden md:inline">
                          {confirmCancel ? "Confirmer l'annulation" : "Annuler le rendez-vous"}
                        </span>
                      </button>
                      {manualWhatsApp ? (
                        <a
                          href={manualWhatsApp}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-quiet order-3 w-11 shrink-0 px-0 md:order-none"
                          style={{ color: "var(--whatsapp)" }}
                          aria-label="Confirmer sur WhatsApp"
                          title="Confirmer sur WhatsApp"
                        >
                          <WhatsApp size={20} />
                        </a>
                      ) : (
                        <span className="order-3 md:hidden" aria-hidden />
                      )}
                      {editing.status === "done" ? (
                        <button
                          type="button"
                          className="btn-secondary order-1 min-w-0 flex-1 px-1.5 text-[13px] md:order-none md:flex-none md:px-3 md:text-[15px]"
                          onClick={() => mutateStatus("confirmed")}
                          title="Rétablir ce rendez-vous (non terminé)"
                        >
                          <RotateCcw size={16} />
                          <span className="truncate">Non terminé</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary order-1 min-w-0 flex-1 px-1.5 text-[13px] md:order-none md:flex-none md:px-3 md:text-[15px]"
                          onClick={() => mutateStatus("done")}
                          title="Marquer comme terminé"
                        >
                          <span className="shrink-0" style={{ color: "var(--success)" }}>
                            <Check size={17} />
                          </span>
                          <span className="truncate">Terminé</span>
                        </button>
                      )}
                    </>
                  ) : null}
                  <button
                    type="submit"
                    className="btn-primary order-first min-w-0 flex-1 px-1.5 text-[13px] md:order-none md:min-w-[170px] md:flex-none md:px-4 md:text-[15px]"
                    disabled={busy || blocksSubmit || (isPastDay && !editing)}
                  >
                    <span className="truncate">
                      {busy
                        ? "Enregistrement…"
                        : editing
                          ? "Enregistrer"
                          : `Réserver à ${minutesToLabel(startMin)}`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}

/**
 * A new booking's date: today and tomorrow one tap away — the two answers
 * that cover almost every call — with a native picker for anything else, so
 * "whenever he wants" never means leaving the sheet to renavigate the board.
 */
function DateField({
  value,
  today,
  onChange,
}: {
  value: string;
  today: string;
  onChange: (date: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const tomorrow = addDays(today, 1);
  const isOther = value !== today && value !== tomorrow;
  const otherLabel = isOther ? formatShortDate(value) : "Choisir une date";

  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"top" | "bottom">("top");
  const popRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      setPlacement(below < 320 || rect.top > below ? "top" : "bottom");
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent) {
      const target = event.target as Node;
      if (
        popRef.current &&
        !popRef.current.contains(target) &&
        !buttonRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div role="radiogroup" aria-labelledby="date-label" className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        role="radio"
        className="time-chip px-3"
        aria-checked={value === today}
        onClick={() => onChange(today)}
      >
        Aujourd&apos;hui
      </button>
      <button
        type="button"
        role="radio"
        className="time-chip px-3"
        aria-checked={value === tomorrow}
        onClick={() => onChange(tomorrow)}
      >
        Demain
      </button>

      {/* Phone: the platform's own picker — a wheel it already knows, never
          fighting the touch keyboard. */}
      <span className="relative inline-flex transition-transform active:scale-95 md:hidden">
        <span
          role="radio"
          className="time-chip pointer-events-none flex items-center gap-1.5 px-3"
          aria-checked={isOther}
        >
          <CalendarIcon size={15} />
          <span data-nums>{otherLabel}</span>
        </span>
        <input
          ref={inputRef}
          type="date"
          value={value}
          min={today}
          max="2100-12-31"
          onChange={(e) => {
            if (isValidDateString(e.target.value)) onChange(e.target.value);
          }}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker?.();
            } catch {}
          }}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none text-[16px] opacity-0"
          aria-label="Choisir une date"
        />
      </span>

      {/* Desktop: a proper calendar, not the OS's plain field-and-popup. */}
      <div className={`relative hidden md:inline-flex ${open ? "z-[var(--z-popover)]" : ""}`}>
        <button
          ref={buttonRef}
          type="button"
          role="radio"
          className="time-chip flex items-center gap-1.5 px-3"
          aria-checked={isOther}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-open={open ? "" : undefined}
          onClick={toggle}
        >
          <CalendarIcon size={15} />
          <span data-nums>{otherLabel}</span>
        </button>
        {open ? (
          <div
            ref={popRef}
            role="dialog"
            aria-label="Choisir une date"
            className={`popover absolute right-0 z-[var(--z-popover)] shadow-2xl ${
              placement === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"
            }`}
          >
            <Calendar
              value={value}
              today={today}
              onSelect={(date) => {
                onChange(date);
                setOpen(false);
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NotesField({ notes, onChange }: { notes: string; onChange: (notes: string) => void }) {
  return (
    <div>
      <label className="label" htmlFor="notes">
        Note <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>(facultatif)</span>
      </label>
      <textarea
        id="notes"
        className="field resize-none"
        rows={2}
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        maxLength={1000}
        placeholder="Allergie, préférence, remarque"
      />
    </div>
  );
}

const STATE_TITLES: Record<SlotAvailability["state"], string> = {
  free: "Libre",
  taken: "Déjà réservé pour ce service",
  past: "Heure passée",
  overflow: "Dépasse l'heure de fermeture",
};

/**
 * Start times as one tap each, grouped by part of the day. A radio group:
 * one tab stop, arrows move between the times that can be chosen.
 */
function TimeGrid({
  availability,
  value,
  editing,
  onChange,
}: {
  availability: SlotAvailability[];
  value: number;
  editing: boolean;
  onChange: (startMin: number) => void;
}) {
  // A new booking cannot start in the past, so past times are left out
  // rather than drawn disabled; editing shows them, for the booking's own.
  const shown = editing
    ? availability
    : availability.filter((s) => s.state !== "past" || s.startMin === value);
  const choosable = shown.filter((s) => s.state === "free" || s.startMin === value || (editing && s.state === "past"));
  const hasTaken = shown.some((s) => s.state === "taken");

  const move = (from: number, delta: number) => {
    const index = choosable.findIndex((s) => s.startMin === from);
    const next = choosable[Math.min(choosable.length - 1, Math.max(0, index + delta))];
    if (!next) return;
    onChange(next.startMin);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-time="${next.startMin}"]`)?.focus();
    });
  };

  if (shown.length === 0) {
    return (
      <p className="t-small rounded-[10px] px-3 py-3" style={{ background: "var(--surface-sunk)", color: "var(--ink-soft)" }}>
        Plus aucune heure disponible ce jour.
      </p>
    );
  }

  return (
    <div role="radiogroup" aria-labelledby="time-label" className="flex flex-col gap-1.5 md:gap-3">
      {PERIODS.map((period) => {
        const items = shown.filter((s) => s.startMin >= period.from && s.startMin < period.to);
        if (items.length === 0) return null;
        return (
          <div key={period.label}>
            <p className="mb-1 text-[11px] font-semibold md:text-[12px]" style={{ color: "var(--ink-soft)" }}>
              {period.label}
            </p>
            <div className="time-grid">
              {items.map((slot) => {
                const checked = slot.startMin === value;
                const enabled = slot.state === "free" || checked || (editing && slot.state === "past");
                const label = minutesToLabel(slot.startMin);
                return (
                  <button
                    key={slot.startMin}
                    type="button"
                    role="radio"
                    data-time={slot.startMin}
                    data-state={slot.state}
                    aria-checked={checked}
                    aria-disabled={!enabled || undefined}
                    aria-label={slot.state === "free" ? label : `${label}, ${STATE_TITLES[slot.state].toLowerCase()}`}
                    title={STATE_TITLES[slot.state]}
                    tabIndex={checked || (!choosable.some((s) => s.startMin === value) && slot === choosable[0]) ? 0 : -1}
                    className="time-chip"
                    onClick={() => {
                      if (enabled) onChange(slot.startMin);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                        e.preventDefault();
                        move(slot.startMin, 1);
                      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                        e.preventDefault();
                        move(slot.startMin, -1);
                      } else if (e.key === "Home") {
                        e.preventDefault();
                        move(slot.startMin, -choosable.length);
                      } else if (e.key === "End") {
                        e.preventDefault();
                        move(slot.startMin, choosable.length);
                      }
                    }}
                    data-nums
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {hasTaken ? (
        <p className="t-small" style={{ color: "var(--ink-faint)" }}>
          Heures barrées : déjà réservées pour ce service à ce moment-là.
        </p>
      ) : null}
    </div>
  );
}

function Advisory({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className="t-small rounded-[10px] px-2.5 py-2 md:px-3 md:py-2.5"
      style={
        tone === "danger"
          ? { background: "var(--danger-tint)", color: "var(--danger)" }
          : { background: "var(--accent-tint)", color: "var(--ink-soft)" }
      }
    >
      {children}
    </div>
  );
}

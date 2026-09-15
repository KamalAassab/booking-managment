"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { DialogState } from "@/components/bookings-board";
import { ClientCombobox } from "@/components/client-combobox";
import { Check, Close, RotateCcw, WhatsApp } from "@/components/icons";
import { SelectDropdown } from "@/components/ui/select";
import type { ToastMessage } from "@/components/toast";
import { formatDuration, slotAvailability, type SlotAvailability } from "@/lib/day-layout";
import type { DeviceMode } from "@/lib/device";
import { formatPhoneForDisplay, normalizePhone } from "@/lib/phone";
import {
  findCatalogEntry,
  groupCatalog,
  type ServiceCatalogEntry,
} from "@/lib/services-catalog";
import {
  conflictsWithExisting,
  formatDayTitle,
  minutesToLabel,
  nowMinutesInSalonTz,
  slotsForSalon,
} from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";
import { DURATION_OPTIONS } from "@/lib/validation";
import { buildWhatsAppLink } from "@/lib/whatsapp";

const CUSTOM_SERVICE = "Autre";
const SLOT_TAKEN = "Ce créneau vient d'être réservé sur un autre poste.";
/** How long "Confirmer l'annulation" waits for its second tap. */
const CONFIRM_MS = 4000;

type Props = {
  state: NonNullable<DialogState>;
  salon: SalonDTO;
  date: string;
  today: string;
  bookings: BookingDTO[];
  /** The salon's bookable services — the owner's live catalogue. */
  catalog: ServiceCatalogEntry[];
  mode: DeviceMode;
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
  mode,
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
  // A new booking starts with no service: the first entry of a sixty-line
  // catalogue is almost never the right one, and a wrong default is saved
  // silently.
  const [service, setService] = useState(() => {
    if (!editing) return "";
    return catalogEntryFor(editing.service)?.name ?? CUSTOM_SERVICE;
  });
  const [customService, setCustomService] = useState(
    editing && !catalogEntryFor(editing.service) ? editing.service : "",
  );
  const [startMin, setStartMin] = useState(
    state.kind === "edit" ? state.booking.startMin : state.startMin,
  );
  const [durationMin, setDurationMin] = useState(
    editing?.durationMin ?? salon.slotMin,
  );
  const [price, setPrice] = useState<number | "">(
    editing ? (catalogEntryFor(editing.service)?.price ?? "") : "",
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  /** A real service pre-fills its standard duration and price; both stay editable. */
  function handleServiceChange(name: string) {
    setService(name);
    setError(null);
    const entry = catalogEntryFor(name);
    if (entry) {
      setDurationMin(entry.durationMin);
      setPrice(entry.price);
    } else {
      setPrice("");
    }
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

  const nowMin = date === today ? nowMinutesInSalonTz() : null;
  const isPastDay = date < today;
  const resolvedService = service === CUSTOM_SERVICE ? customService.trim() : service;

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
        { durationMin, service: resolvedService },
        (s) =>
          conflictsWithExisting(
            { startMin: s, durationMin, service: resolvedService },
            bookings,
            editing?.id,
          ),
        isPastDay ? 24 * 60 : nowMin,
      ),
    [salon, slots, durationMin, resolvedService, bookings, editing?.id, isPastDay, nowMin],
  );

  const selected = availability.find((s) => s.startMin === startMin);
  const selectedState: SlotAvailability["state"] = selected?.state ?? "free";
  // An edit that leaves the time alone is never blocked by it: the booking
  // keeps the slot it already holds, even if the hours or the clock have
  // moved since. Only a new time, or a new service at that time, is checked.
  const timeChanged =
    !editing || startMin !== editing.startMin || durationMin !== editing.durationMin;
  const serviceChanged =
    !editing || resolvedService.trim().toLowerCase() !== editing.service.trim().toLowerCase();
  const blocksSubmit =
    (selectedState === "taken" && (timeChanged || serviceChanged)) ||
    (selectedState === "overflow" && timeChanged) ||
    (!editing && selectedState === "past");
  const nextFree = availability.find((s) => s.state === "free" && s.startMin > startMin)
    ?? availability.find((s) => s.state === "free");

  // Same for a duration the owner set that is not one of the usual options.
  const durations = useMemo(() => {
    const options: number[] = [...DURATION_OPTIONS];
    return options.includes(durationMin)
      ? options
      : [...options, durationMin].sort((a, b) => a - b);
  }, [durationMin]);

  const endMin = startMin + durationMin;

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
    if (!resolvedService) {
      setError(service === CUSTOM_SERVICE ? "Précisez le service." : "Choisissez un service.");
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
          service: resolvedService,
          notes,
        };
        if (startMin !== editing.startMin) patch.startMin = startMin;
        if (durationMin !== editing.durationMin) patch.durationMin = durationMin;
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
            bookingDate: date,
            startMin,
            durationMin,
            service: resolvedService,
            notes,
            channel: mode,
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
        durationMin: saved.durationMin,
        service: saved.service,
        price,
        notes: saved.notes,
        catalog,
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
        durationMin: editing.durationMin,
        service: editing.service,
        notes: editing.notes,
        catalog,
      })
    : null;

  const summaryTime = `${minutesToLabel(startMin)} à ${minutesToLabel(endMin)}`;
  const summaryDetail = [
    formatDuration(durationMin),
    price !== "" ? `${price} MAD` : null,
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
        <div className="flex justify-center pt-2 md:hidden" aria-hidden>
          <span className="block h-1 w-9 rounded-full" style={{ background: "var(--line-strong)" }} />
        </div>

        <div className="flex items-start gap-3 border-b px-5 pb-3 pt-3 md:px-6 md:pt-5" style={{ borderColor: "var(--line)" }}>
          <div className="min-w-0 flex-1">
            <h2 id="sheet-title" className="t-title">
              {editing ? "Modifier le rendez-vous" : "Nouveau rendez-vous"}
            </h2>
            <p className="t-small truncate first-letter:uppercase" style={{ color: "var(--ink-faint)" }}>
              {formatDayTitle(date, today)} · {salon.name}
            </p>
          </div>
          {editing?.status === "done" ? (
            <span className="chip chip-success mt-1 shrink-0">
              <Check size={13} />
              Terminé
            </span>
          ) : null}
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            aria-label="Fermer"
            className="btn-icon -mr-2 -mt-1"
          >
            <Close size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <fieldset disabled={busy} className="contents">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 md:px-6 md:py-5">
              <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-7">
                {/* ---- Who and what ---- */}
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-1">
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
                          // A returning client usually books what they had last time.
                          const last = client.service ? catalogEntryFor(client.service) : undefined;
                          if (!service && last) handleServiceChange(last.name);
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

                  <div>
                    <label className="label" htmlFor="service">
                      Service
                    </label>
                    <SelectDropdown<string>
                      id="service"
                      value={service}
                      onChange={handleServiceChange}
                      placeholder="Choisir un service"
                      searchable
                      searchPlaceholder="Rechercher un service"
                      groups={groups
                        .map((group) => ({
                          category: group.category,
                          items: group.items.map((entry) => ({
                            value: entry.name,
                            label: entry.name,
                            description: `${formatDuration(entry.durationMin)} · ${entry.price} MAD`,
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
                  </div>

                  {service === CUSTOM_SERVICE ? (
                    <div>
                      <label className="label" htmlFor="customService">
                        Précisez le service
                      </label>
                      <input
                        id="customService"
                        className="field"
                        value={customService}
                        onChange={(e) => {
                          setCustomService(e.target.value);
                          setError(null);
                        }}
                        maxLength={120}
                        placeholder="Nom du service"
                      />
                    </div>
                  ) : null}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label" htmlFor="durationMin">
                        Durée
                      </label>
                      <SelectDropdown<number>
                        id="durationMin"
                        value={durationMin}
                        onChange={(value) => {
                          setDurationMin(value);
                          setError(null);
                        }}
                        options={durations.map((d) => ({ value: d, label: formatDuration(d) }))}
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor="price">
                        Tarif
                      </label>
                      <div className="relative flex items-center">
                        <input
                          id="price"
                          className="field pr-12"
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          value={price}
                          onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))}
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

                  <div className="hidden md:block">
                    <NotesField notes={notes} onChange={setNotes} />
                  </div>
                </div>

                {/* ---- When ---- */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="label mb-0" id="time-label">
                      Heure de début
                    </span>
                    <span className="t-small truncate" style={{ color: "var(--ink-faint)" }}>
                      {resolvedService
                        ? `Disponibilités pour ${formatDuration(durationMin)}`
                        : "Choisissez un service pour affiner"}
                    </span>
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
                  ) : selectedState === "taken" && (timeChanged || serviceChanged) ? (
                    <Advisory tone="danger">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>
                          {minutesToLabel(startMin)} chevauche déjà{" "}
                          {resolvedService ? `« ${resolvedService} »` : "un rendez-vous"}.
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

                  <div className="md:hidden">
                    <NotesField notes={notes} onChange={setNotes} />
                  </div>
                </div>
              </div>

              {error ? (
                <p
                  role="alert"
                  className="t-small mt-4 rounded-[10px] px-3 py-2.5"
                  style={{ background: "var(--danger-tint)", color: "var(--danger)" }}
                >
                  {error}
                </p>
              ) : null}
            </div>

            {/* Actions stay pinned, in the same place whether the form scrolls or not. */}
            <div
              className="border-t px-5 pt-3 md:px-6 md:py-4"
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
                    {resolvedService ? <span style={{ color: "var(--ink-soft)" }}> · {resolvedService}</span> : null}
                  </p>
                  <p className="t-small truncate" style={{ color: "var(--ink-faint)" }} data-nums>
                    {summaryDetail}
                  </p>
                </div>

                {/* Phone: the save on its own full-width row, the status
                    actions in equal columns under it. Wider: one row. */}
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 md:flex md:flex-nowrap md:items-center">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        className={`btn-danger order-2 px-3 md:order-none ${confirmCancel ? "btn-confirm" : ""}`}
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
                          className="btn-quiet order-3 w-11 px-0 md:order-none"
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
                          className="btn-secondary order-1 px-3 md:order-none"
                          onClick={() => mutateStatus("confirmed")}
                          title="Rétablir ce rendez-vous (non terminé)"
                        >
                          <RotateCcw size={16} />
                          <span className="truncate">Non terminé</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary order-1 px-3 md:order-none"
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
                    className="btn-primary order-first col-span-3 md:order-none md:min-w-[170px]"
                    disabled={busy || blocksSubmit || (isPastDay && !editing)}
                  >
                    {busy
                      ? "Enregistrement…"
                      : editing
                        ? "Enregistrer"
                        : `Réserver à ${minutesToLabel(startMin)}`}
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
    <div role="radiogroup" aria-labelledby="time-label" className="flex flex-col gap-3">
      {PERIODS.map((period) => {
        const items = shown.filter((s) => s.startMin >= period.from && s.startMin < period.to);
        if (items.length === 0) return null;
        return (
          <div key={period.label}>
            <p className="mb-1.5 text-[12px] font-semibold" style={{ color: "var(--ink-soft)" }}>
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
      className="t-small rounded-[10px] px-3 py-2.5"
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

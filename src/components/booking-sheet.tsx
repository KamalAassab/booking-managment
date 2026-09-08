"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { DialogState } from "@/components/bookings-board";
import { Check, Close, WhatsApp } from "@/components/icons";
import type { ToastMessage } from "@/components/toast";
import type { DeviceMode } from "@/lib/device";
import { formatPhoneForDisplay } from "@/lib/phone";
import { conflictsWithExisting, minutesToLabel, slotsForSalon } from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";
import { DURATION_OPTIONS, SERVICES } from "@/lib/validation";
import { buildWhatsAppLink } from "@/lib/whatsapp";

type Props = {
  state: NonNullable<DialogState>;
  salon: SalonDTO;
  date: string;
  bookings: BookingDTO[];
  mode: DeviceMode;
  onClose: () => void;
  onChanged: () => void;
  onToast: (toast: ToastMessage) => void;
};

/**
 * Create or edit a booking.
 *
 * A bottom sheet below `md` and a centred panel above it. On a phone the
 * sheet is the correct shape: it arrives from the edge the thumb is already
 * near, and its actions land in the same place every time.
 */
export function BookingSheet({
  state,
  salon,
  date,
  bookings,
  mode,
  onClose,
  onChanged,
  onToast,
}: Props) {
  const editing = state.kind === "edit" ? state.booking : null;

  const [clientName, setClientName] = useState(editing?.clientName ?? "");
  const [clientPhone, setClientPhone] = useState(
    editing ? formatPhoneForDisplay(editing.clientPhone) : "",
  );
  const [service, setService] = useState(
    editing && !SERVICES.includes(editing.service as (typeof SERVICES)[number])
      ? "Autre"
      : (editing?.service ?? SERVICES[0]),
  );
  const [customService, setCustomService] = useState(
    editing && !SERVICES.includes(editing.service as (typeof SERVICES)[number])
      ? editing.service
      : "",
  );
  const [startMin, setStartMin] = useState(
    state.kind === "create" ? state.startMin : state.booking.startMin,
  );
  const [durationMin, setDurationMin] = useState(
    editing?.durationMin ?? salon.slotMin,
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const returnFocusTo = useRef<Element | null>(null);

  useEffect(() => {
    returnFocusTo.current = document.activeElement;
    firstFieldRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus stays inside while the sheet is open; tabbing past the last
      // control returns to the first rather than escaping to the grid behind.
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
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
    };

    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      (returnFocusTo.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  const slots = useMemo(() => slotsForSalon(salon), [salon]);
  const resolvedService = service === "Autre" ? customService.trim() : service;

  // Advisory only — the database exclusion constraint is the real guarantee.
  // This just stops an agent submitting something we already know will fail.
  const localConflict = conflictsWithExisting(
    { startMin, durationMin },
    bookings,
    editing?.id,
  );
  const overflowsClosing = startMin + durationMin > salon.closesAtMin;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!resolvedService) {
      setError("Précisez le service.");
      return;
    }

    // Popup blockers only allow window.open inside the click that triggered
    // it, so for the call-centre flow the tab is opened synchronously here
    // and pointed at the wa.me URL once the server confirms the booking.
    const wantsWhatsApp = mode === "call_center" && !editing;
    const waTab = wantsWhatsApp ? window.open("", "_blank") : null;

    setBusy(true);
    try {
      const res = editing
        ? await fetch(`/api/bookings/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientName: clientName.trim(),
              clientPhone,
              startMin,
              durationMin,
              service: resolvedService,
              notes,
            }),
          })
        : await fetch("/api/bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              salonSlug: salon.slug,
              clientName: clientName.trim(),
              clientPhone,
              bookingDate: date,
              startMin,
              durationMin,
              service: resolvedService,
              notes,
              channel: mode,
            }),
          });

      const data = (await res.json()) as {
        error?: string;
        whatsappUrl?: string | null;
        booking?: BookingDTO;
      };

      if (!res.ok) {
        waTab?.close();
        setError(data.error ?? "Erreur inattendue.");
        // A 409 means someone else won the slot — pull the fresh day in so
        // the grid behind already shows who took it.
        if (res.status === 409) onChanged();
        return;
      }

      if (waTab && data.whatsappUrl) {
        waTab.location.href = data.whatsappUrl;
        onToast({
          tone: "success",
          text: "Rendez-vous enregistré. Envoyez le message dans l'onglet ouvert.",
        });
      } else if (wantsWhatsApp && data.whatsappUrl) {
        // Tab was blocked — hand the agent a link instead of losing the step.
        onToast({
          tone: "success",
          text: "Rendez-vous enregistré.",
          action: { label: "Ouvrir WhatsApp", href: data.whatsappUrl },
        });
      } else {
        onToast({
          tone: "success",
          text: editing ? "Rendez-vous mis à jour." : "Rendez-vous enregistré.",
        });
      }

      onChanged();
      onClose();
    } catch {
      waTab?.close();
      setError("Connexion perdue. Vérifiez le réseau et réessayez.");
    } finally {
      setBusy(false);
    }
  }

  async function mutateStatus(status: "cancelled" | "done") {
    if (!editing || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res =
        status === "cancelled"
          ? await fetch(`/api/bookings/${editing.id}`, { method: "DELETE" })
          : await fetch(`/api/bookings/${editing.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status }),
            });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Erreur inattendue.");
        return;
      }
      onToast({
        tone: "success",
        text:
          status === "cancelled"
            ? "Rendez-vous annulé."
            : "Marqué comme terminé.",
      });
      onChanged();
      onClose();
    } catch {
      setError("Connexion perdue. Vérifiez le réseau et réessayez.");
    } finally {
      setBusy(false);
    }
  }

  const manualWhatsApp = editing
    ? buildWhatsAppLink({
        clientName: editing.clientName,
        clientPhone: editing.clientPhone,
        salonName: salon.name,
        bookingDate: editing.bookingDate,
        startMin: editing.startMin,
        service: editing.service,
      })
    : null;

  return (
    <div
      className="anim-fade fixed inset-0 z-40 flex items-end justify-center md:items-center md:p-4"
      style={{ background: "rgb(20 24 26 / 0.32)", backdropFilter: "blur(2px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className="anim-sheet flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[20px] md:anim-panel md:max-w-[480px] md:rounded-[20px]"
        style={{ background: "var(--surface)", boxShadow: "var(--shadow-sheet)" }}
      >
        {/* Grab handle: mobile only, and decorative — the close button is the
            real control. */}
        <div className="flex justify-center pt-2.5 md:hidden" aria-hidden>
          <span
            className="block h-1 w-9 rounded-full"
            style={{ background: "var(--line-strong)" }}
          />
        </div>

        <div className="flex items-start gap-3 px-5 pb-4 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id="sheet-title" className="t-heading">
              {editing ? "Modifier le rendez-vous" : "Nouveau rendez-vous"}
            </h2>
            <p className="t-small" style={{ color: "var(--ink-faint)" }}>
              {salon.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
            style={{ color: "var(--ink-soft)" }}
          >
            <Close size={18} />
          </button>
        </div>

        <form
          onSubmit={submit}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5"
        >
          <div className="flex flex-col gap-4 pb-4">
            <div>
              <label className="label" htmlFor="clientName">
                Client
              </label>
              <input
                ref={firstFieldRef}
                id="clientName"
                className="field"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                required
                minLength={2}
                maxLength={120}
                autoComplete="off"
                placeholder="Nom et prénom"
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
                onChange={(e) => setClientPhone(e.target.value)}
                required
                placeholder="06 12 34 56 78"
                autoComplete="off"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="startMin">
                  Heure
                </label>
                <select
                  id="startMin"
                  className="field"
                  value={startMin}
                  onChange={(e) => setStartMin(Number(e.target.value))}
                >
                  {slots.map((s) => (
                    <option key={s} value={s}>
                      {minutesToLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="durationMin">
                  Durée
                </label>
                <select
                  id="durationMin"
                  className="field"
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                >
                  {DURATION_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} min
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="service">
                Service
              </label>
              <select
                id="service"
                className="field"
                value={service}
                onChange={(e) => setService(e.target.value)}
              >
                {SERVICES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {service === "Autre" ? (
              <div>
                <label className="label" htmlFor="customService">
                  Précisez
                </label>
                <input
                  id="customService"
                  className="field"
                  value={customService}
                  onChange={(e) => setCustomService(e.target.value)}
                  maxLength={120}
                  placeholder="Lequel ?"
                />
              </div>
            ) : null}

            <div>
              <label className="label" htmlFor="notes">
                Note <span style={{ textTransform: "none" }}>(facultatif)</span>
              </label>
              <textarea
                id="notes"
                className="field"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
                placeholder="Allergie, préférence, remarque…"
              />
            </div>

            {localConflict ? (
              <Advisory>
                Ce créneau chevauche un autre rendez-vous. Le serveur le
                refusera.
              </Advisory>
            ) : null}

            {overflowsClosing ? (
              <Advisory>
                Ce rendez-vous dépasse l&apos;heure de fermeture (
                {minutesToLabel(salon.closesAtMin)}).
              </Advisory>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="t-small rounded-[10px] px-3 py-2.5"
                style={{ background: "var(--danger-tint)", color: "var(--danger)" }}
              >
                {error}
              </p>
            ) : null}
          </div>

          {/* Actions stay pinned so they are in the same place whether the
              form scrolls or not. */}
          <div
            className="sticky bottom-0 -mx-5 mt-auto border-t px-5 pb-5 pt-4"
            style={{
              borderColor: "var(--line)",
              background: "var(--surface)",
              paddingBottom: "max(20px, env(safe-area-inset-bottom))",
            }}
          >
            <div className="flex gap-2">
              <button
                type="submit"
                className="btn-primary flex-1"
                disabled={busy || localConflict || overflowsClosing}
              >
                {busy ? "…" : editing ? "Enregistrer" : "Réserver"}
              </button>
              {editing && editing.status !== "done" ? (
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => mutateStatus("done")}
                  disabled={busy}
                  aria-label="Marquer comme terminé"
                >
                  <Check size={18} />
                </button>
              ) : null}
            </div>

            {editing ? (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="btn-danger flex-1"
                  onClick={() => mutateStatus("cancelled")}
                  disabled={busy}
                >
                  Annuler le rendez-vous
                </button>
                {manualWhatsApp ? (
                  <a
                    href={manualWhatsApp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-quiet"
                    aria-label="Ouvrir WhatsApp"
                  >
                    <WhatsApp size={18} />
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}

function Advisory({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="t-small rounded-[10px] px-3 py-2.5"
      style={{ background: "var(--brass-tint)", color: "var(--ink-soft)" }}
    >
      {children}
    </p>
  );
}

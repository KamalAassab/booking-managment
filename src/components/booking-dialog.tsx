"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { DialogState } from "@/components/bookings-board";
import type { ToastMessage } from "@/components/toast";
import type { DeviceMode } from "@/lib/device";
import { formatPhoneForDisplay } from "@/lib/phone";
import {
  conflictsWithExisting,
  minutesToLabel,
  slotsForSalon,
} from "@/lib/time";
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

export function BookingDialog({
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

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
        // the grid behind the dialog already shows who took it.
        if (res.status === 409) onChanged();
        return;
      }

      if (waTab && data.whatsappUrl) {
        waTab.location.href = data.whatsappUrl;
        onToast({
          tone: "success",
          text: "Réservation enregistrée. Envoyez le message WhatsApp dans l'onglet ouvert.",
        });
      } else if (wantsWhatsApp && data.whatsappUrl) {
        // Tab was blocked — hand the agent a link instead of losing the step.
        onToast({
          tone: "success",
          text: "Réservation enregistrée.",
          action: { label: "Ouvrir WhatsApp", href: data.whatsappUrl },
        });
      } else {
        onToast({
          tone: "success",
          text: editing ? "Réservation mise à jour." : "Réservation enregistrée.",
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
        text: status === "cancelled" ? "Réservation annulée." : "Marquée comme terminée.",
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
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-dialog-title"
        className="panel max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl shadow-xl sm:rounded-2xl"
      >
        <form onSubmit={submit} className="p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2
                id="booking-dialog-title"
                className="text-lg font-semibold tracking-tight"
              >
                {editing ? "Modifier le rendez-vous" : "Nouveau rendez-vous"}
              </h2>
              <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
                {salon.name} · {date} · {minutesToLabel(startMin)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost !px-2.5 !py-1"
              aria-label="Fermer"
            >
              ✕
            </button>
          </div>

          {mode === "call_center" && !editing ? (
            <p className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-800 dark:border-brand-800 dark:bg-brand-900/25 dark:text-brand-200">
              Poste centre d&apos;appels : un onglet WhatsApp pré-rempli
              s&apos;ouvrira après l&apos;enregistrement. Un seul clic sur
              Envoyer suffit.
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="clientName">
                Nom du client
              </label>
              <input
                id="clientName"
                ref={firstFieldRef}
                className="field"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                required
                minLength={2}
                maxLength={120}
                autoComplete="off"
                placeholder="Ex. Salma Bennani"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="label" htmlFor="clientPhone">
                Téléphone
              </label>
              <input
                id="clientPhone"
                className="field"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                required
                inputMode="tel"
                autoComplete="off"
                placeholder="06 12 34 56 78"
              />
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                Utilisé pour le message WhatsApp de confirmation.
              </p>
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

            {service === "Autre" ? (
              <div className="sm:col-span-2">
                <label className="label" htmlFor="customService">
                  Préciser le service
                </label>
                <input
                  id="customService"
                  className="field"
                  value={customService}
                  onChange={(e) => setCustomService(e.target.value)}
                  maxLength={120}
                  required
                />
              </div>
            ) : null}

            <div className="sm:col-span-2">
              <label className="label" htmlFor="startMin">
                Heure
              </label>
              <select
                id="startMin"
                className="field"
                value={startMin}
                onChange={(e) => setStartMin(Number(e.target.value))}
              >
                {slots.map((slot) => {
                  const taken = conflictsWithExisting(
                    { startMin: slot, durationMin: salon.slotMin },
                    bookings,
                    editing?.id,
                  );
                  return (
                    <option key={slot} value={slot} disabled={taken}>
                      {minutesToLabel(slot)}
                      {taken ? " — occupé" : ""}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="label" htmlFor="notes">
                Notes <span className="normal-case">(optionnel)</span>
              </label>
              <textarea
                id="notes"
                className="field resize-y"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
                placeholder="Préférence de coiffeuse, allergie, retard annoncé…"
              />
            </div>
          </div>

          {localConflict ? (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Ce créneau chevauche un rendez-vous existant.
            </p>
          ) : null}

          {overflowsClosing ? (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Cette durée dépasse l&apos;heure de fermeture du salon.
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || localConflict || overflowsClosing}
            >
              {busy
                ? "Enregistrement…"
                : editing
                  ? "Enregistrer"
                  : "Réserver"}
            </button>
            <button type="button" onClick={onClose} className="btn-ghost">
              Annuler
            </button>

            {editing ? (
              <div className="ml-auto flex flex-wrap gap-2">
                {manualWhatsApp ? (
                  <a
                    href={manualWhatsApp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost"
                  >
                    WhatsApp
                  </a>
                ) : null}
                {editing.status !== "done" ? (
                  <button
                    type="button"
                    onClick={() => mutateStatus("done")}
                    className="btn-ghost"
                    disabled={busy}
                  >
                    Terminé
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => mutateStatus("cancelled")}
                  className="btn-danger"
                  disabled={busy}
                >
                  Annuler le RDV
                </button>
              </div>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}

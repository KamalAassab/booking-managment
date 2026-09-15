"use client";

import { Check, Note, Phone, WhatsApp } from "@/components/icons";
import {
  formatDuration,
  formatRemaining,
  formatStartsIn,
  type BookingPhase,
} from "@/lib/day-layout";
import { formatPhoneForDisplay } from "@/lib/phone";
import { findCatalogEntry, type ServiceCatalogEntry } from "@/lib/services-catalog";
import { minutesToLabel } from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";
import { buildWhatsAppLink } from "@/lib/whatsapp";

/**
 * Every booking in the interface is drawn by one of these three, so a
 * booking looks like itself wherever it appears: a block on the day's
 * timeline, a card in the phone agenda, a line in a side panel or a week
 * column. Status is carried by the card's surface and leading rule
 * (`data-phase`, styled in globals.css), never by a sticker.
 */

const PHASE_WORDS: Record<BookingPhase, string> = {
  cancelled: "annulé",
  done: "terminé",
  running: "en cours",
  ended: "passé",
  upcoming: "à venir",
};

/** The whole booking as one sentence, for screen readers and tooltips. */
export function describeBooking(booking: BookingDTO, phase: BookingPhase): string {
  const end = minutesToLabel(booking.startMin + booking.durationMin);
  return `${minutesToLabel(booking.startMin)} à ${end}, ${booking.clientName}, ${booking.service}, ${PHASE_WORDS[phase]}`;
}

function priceOf(booking: BookingDTO, catalog: readonly ServiceCatalogEntry[]) {
  return findCatalogEntry(catalog, booking.service)?.price;
}

function DoneMark({ size = 14 }: { size?: number }) {
  return (
    <span className="shrink-0" style={{ color: "var(--success)" }}>
      <Check size={size} />
    </span>
  );
}

/* ---- Timeline block ------------------------------------------------------ */

/**
 * Sized by the time it covers. Its container (`.bk-slot`) is a size query
 * container, so a half-hour block shows the time inline with the name, and a
 * longer one adds a time row, then the phone, then the note, as its own
 * height allows: the same component reads well at 45px and at 300px.
 */
export function TimelineBooking({
  booking,
  phase,
  catalog,
  nowMin,
  onSelect,
}: {
  booking: BookingDTO;
  phase: BookingPhase;
  catalog: readonly ServiceCatalogEntry[];
  nowMin: number;
  onSelect: () => void;
}) {
  const price = priceOf(booking, catalog);
  const end = booking.startMin + booking.durationMin;
  const label = describeBooking(booking, phase);

  return (
    <button
      type="button"
      className="bk w-full"
      data-phase={phase}
      onClick={onSelect}
      aria-label={label}
      title={label}
    >
      <span className="bk-time" data-nums>
        <span>
          {minutesToLabel(booking.startMin)} à {minutesToLabel(end)}
        </span>
        <span className="bk-wide" style={phase === "running" ? undefined : { color: "var(--ink-faint)" }}>
          {phase === "running" ? formatRemaining(end, nowMin) : formatDuration(booking.durationMin)}
        </span>
        {booking.channel === "call_center" ? (
          <span className="bk-wide ml-auto" style={{ color: "var(--ink-faint)" }}>
            <Phone size={12} />
          </span>
        ) : null}
      </span>
      <span className="bk-name">
        {phase === "done" ? <DoneMark /> : null}
        <span className="bk-inline-time" data-nums>
          {minutesToLabel(booking.startMin)}
        </span>
        <span className="truncate">{booking.clientName}</span>
      </span>
      <span className="bk-line">
        {booking.service}
        {price !== undefined ? (
          <span className="bk-wide" data-nums>
            {" "}· {price} MAD
          </span>
        ) : null}
      </span>
      <span className="bk-line bk-tall" data-nums>
        {formatPhoneForDisplay(booking.clientPhone)}
      </span>
      {booking.notes ? (
        <span className="bk-line bk-taller flex items-center gap-1 italic">
          <Note size={12} className="shrink-0" />
          <span className="truncate">{booking.notes}</span>
        </span>
      ) : null}
    </button>
  );
}

/* ---- Agenda card (phone, tablet, month panel) ---------------------------- */

export function AgendaBooking({
  booking,
  phase,
  salon,
  catalog,
  nowMin,
  onSelect,
}: {
  booking: BookingDTO;
  phase: BookingPhase;
  salon: SalonDTO;
  catalog: readonly ServiceCatalogEntry[];
  nowMin: number;
  onSelect: () => void;
}) {
  const price = priceOf(booking, catalog);
  const end = booking.startMin + booking.durationMin;
  // The confirmation is worth one tap only while it can still matter.
  const whatsapp =
    phase === "upcoming" || phase === "running"
      ? buildWhatsAppLink({
          clientName: booking.clientName,
          clientPhone: booking.clientPhone,
          salonName: salon.name,
          salonSlug: salon.slug,
          bookingDate: booking.bookingDate,
          startMin: booking.startMin,
          durationMin: booking.durationMin,
          service: booking.service,
          notes: booking.notes,
          catalog: [...catalog],
        })
      : null;

  return (
    <div className="bk flex-row items-stretch p-0" data-phase={phase}>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-h-[68px] min-w-0 flex-1 flex-col justify-center gap-[3px] py-2.5 pl-[15px] pr-2 text-left"
        aria-label={describeBooking(booking, phase)}
      >
        <span className="bk-name">
          {phase === "done" ? <DoneMark /> : null}
          <span className="truncate">{booking.clientName}</span>
          {phase === "running" ? (
            <span className="chip chip-accent ml-auto shrink-0">En cours</span>
          ) : null}
        </span>
        <span className="bk-line">
          {booking.service}
          <span data-nums>
            {" "}· {formatDuration(booking.durationMin)}
            {price !== undefined ? ` · ${price} MAD` : ""}
          </span>
        </span>
        <span className="bk-line flex items-center gap-1.5" data-nums>
          {booking.channel === "call_center" ? (
            <span className="shrink-0" title="Centre d'appels">
              <Phone size={12} />
            </span>
          ) : null}
          <span className="truncate">{formatPhoneForDisplay(booking.clientPhone)}</span>
          <span aria-hidden>·</span>
          <span
            className="shrink-0"
            style={phase === "running" ? { color: "var(--accent-ink)", fontWeight: 600 } : undefined}
          >
            {phase === "running" ? formatRemaining(end, nowMin) : `fin ${minutesToLabel(end)}`}
          </span>
        </span>
        {booking.notes ? (
          <span className="bk-line flex items-center gap-1 italic">
            <Note size={12} className="shrink-0" />
            <span className="truncate">{booking.notes}</span>
          </span>
        ) : null}
      </button>
      {whatsapp ? (
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-icon mr-1 self-center"
          style={{ color: "var(--whatsapp)" }}
          aria-label={`Confirmer sur WhatsApp à ${booking.clientName}`}
          title="Confirmer sur WhatsApp"
        >
          <WhatsApp size={20} />
        </a>
      ) : null}
    </div>
  );
}

/* ---- Compact line (side panels, week columns) ---------------------------- */

export function CompactBooking({
  booking,
  phase,
  nowMin,
  onSelect,
  detail = "duration",
}: {
  booking: BookingDTO;
  phase: BookingPhase;
  nowMin: number;
  onSelect: () => void;
  /** What the right-hand figure says: the duration, a countdown, or nothing. */
  detail?: "duration" | "countdown" | "none";
}) {
  const end = booking.startMin + booking.durationMin;
  const figure =
    detail === "countdown"
      ? phase === "running"
        ? formatRemaining(end, nowMin)
        : formatStartsIn(booking.startMin, nowMin)
      : detail === "duration"
        ? formatDuration(booking.durationMin)
        : null;
  const label = describeBooking(booking, phase);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="bk w-full flex-row items-center gap-2.5 py-2"
      data-phase={phase}
      aria-label={label}
      title={label}
    >
      <span className="w-[40px] shrink-0 text-[13px] font-semibold" data-nums>
        {minutesToLabel(booking.startMin)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="bk-name text-[13.5px]">
          {phase === "done" ? <DoneMark size={13} /> : null}
          <span className="truncate">{booking.clientName}</span>
        </span>
        <span className="bk-line text-[12px]">{booking.service}</span>
      </span>
      {figure ? (
        <span
          className="shrink-0 text-[12px] font-medium"
          style={{ color: phase === "running" ? "var(--accent-ink)" : "var(--ink-faint)" }}
          data-nums
        >
          {figure}
        </span>
      ) : null}
    </button>
  );
}

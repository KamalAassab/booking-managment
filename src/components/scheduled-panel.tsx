"use client";

import { Check, Phone, Plus, User, WhatsApp } from "@/components/icons";
import { formatPhoneForDisplay } from "@/lib/phone";
import { formatLongDate, minutesToLabel } from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";
import { buildWhatsAppLink } from "@/lib/whatsapp";

type Props = {
  date: string;
  salon: SalonDTO;
  bookings: BookingDTO[];
  onSelectBooking: (booking: BookingDTO) => void;
  onCreate: () => void;
};

/**
 * The selected day, as a timeline rather than the time-proportional column
 * this app used before. It takes over the "read the day" job that column
 * did: still sorted by start time, still silent about cancelled bookings —
 * only the shape changed.
 */
export function ScheduledPanel({
  date,
  salon,
  bookings,
  onSelectBooking,
  onCreate,
}: Props) {
  const active = bookings
    .filter((b) => b.status !== "cancelled")
    .sort((a, b) => a.startMin - b.startMin);

  return (
    <aside className="card flex w-full flex-col p-4 md:p-5 lg:w-[300px] lg:shrink-0">
      <div className="flex items-center justify-between">
        <span className="t-heading">Programme</span>
        <button
          type="button"
          onClick={onCreate}
          aria-label="Nouveau rendez-vous"
          className="flex h-7 w-7 items-center justify-center rounded-[8px] transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
          style={{ color: "var(--accent-hover)" }}
        >
          <Plus size={16} />
        </button>
      </div>
      <p className="t-small mb-4" style={{ color: "var(--ink-faint)" }}>
        <span className="first-letter:uppercase">{formatLongDate(date)}</span>
      </p>

      {active.length === 0 ? (
        <p className="t-small" style={{ color: "var(--ink-faint)" }}>
          Aucun rendez-vous. Touchez le + pour en ajouter un.
        </p>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {active.map((booking) => (
            <TimelineItem
              key={booking.id}
              booking={booking}
              salon={salon}
              onSelect={() => onSelectBooking(booking)}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}

function TimelineItem({
  booking,
  salon,
  onSelect,
}: {
  booking: BookingDTO;
  salon: SalonDTO;
  onSelect: () => void;
}) {
  const done = booking.status === "done";
  const whatsapp = buildWhatsAppLink({
    clientName: booking.clientName,
    clientPhone: booking.clientPhone,
    salonName: salon.name,
    salonSlug: salon.slug,
    bookingDate: booking.bookingDate,
    startMin: booking.startMin,
    durationMin: booking.durationMin,
    service: booking.service,
    notes: booking.notes,
  });

  return (
    <li className="flex gap-2.5">
      <span
        className="w-9 shrink-0 pt-2.5 text-[11.5px] font-semibold"
        style={{ color: "var(--ink-faint)" }}
        data-nums
      >
        {minutesToLabel(booking.startMin)}
      </span>

      <div className="flex min-w-0 flex-1 gap-2.5">
        <span
          aria-hidden
          className="mt-0.5 w-[3px] shrink-0 self-stretch rounded-full"
          style={{ background: done ? "var(--line)" : "var(--accent)" }}
        />

        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 rounded-[12px] p-3 text-left transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
          style={{ background: "var(--surface-sunk)" }}
        >
          <span className="flex items-center gap-1.5">
            {done ? (
              <span className="shrink-0" style={{ color: "var(--ink-faint)" }}>
                <Check size={13} />
              </span>
            ) : null}
            <span
              className="truncate text-[13.5px] font-semibold"
              style={{ color: done ? "var(--ink-soft)" : "var(--ink)" }}
            >
              {booking.clientName}
            </span>
          </span>
          <span
            className="mt-0.5 block truncate text-[12px]"
            style={{ color: "var(--ink-faint)" }}
          >
            {booking.service}
          </span>
          <span
            className="mt-2 block text-[11.5px]"
            style={{ color: "var(--ink-faint)" }}
            data-nums
          >
            {minutesToLabel(booking.startMin)} –{" "}
            {minutesToLabel(booking.startMin + booking.durationMin)}
          </span>

          <span className="mt-2 flex items-center gap-2">
            {/* Bookings are anonymous by design — no per-agent name to show —
                so this badges the channel it arrived on instead of a fake
                avatar. */}
            <span
              aria-hidden
              className="flex h-[18px] w-[18px] items-center justify-center rounded-full"
              style={{ background: "var(--line)", color: "var(--ink-soft)" }}
              title={
                booking.channel === "call_center"
                  ? "Centre d'appels"
                  : "Propriétaire"
              }
            >
              {booking.channel === "call_center" ? (
                <Phone size={10} />
              ) : (
                <User size={10} />
              )}
            </span>
            <span
              className="truncate text-[11px]"
              style={{ color: "var(--ink-faint)" }}
              data-nums
            >
              {formatPhoneForDisplay(booking.clientPhone)}
            </span>

            {whatsapp ? (
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold"
                style={{
                  background: "var(--accent-tint)",
                  color: "var(--accent-hover)",
                }}
              >
                <WhatsApp size={10} />
                WhatsApp
              </a>
            ) : null}
          </span>
        </button>
      </div>
    </li>
  );
}

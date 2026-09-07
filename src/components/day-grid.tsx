"use client";

import { useMemo } from "react";

import { formatPhoneForDisplay } from "@/lib/phone";
import {
  minutesToLabel,
  nowMinutesInSalonTz,
  slotsForSalon,
} from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";

type Props = {
  salon: SalonDTO;
  date: string;
  today: string;
  bookings: BookingDTO[];
  onSelectSlot: (startMin: number) => void;
  onSelectBooking: (booking: BookingDTO) => void;
};

const STATUS_STYLES: Record<
  Exclude<BookingDTO["status"], "cancelled">,
  { card: string; dot: string; label: string }
> = {
  confirmed: {
    card: "border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-900/25",
    dot: "bg-brand-500",
    label: "Confirmé",
  },
  done: {
    card: "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30",
    dot: "bg-emerald-500",
    label: "Terminé",
  },
};

export function DayGrid({
  salon,
  date,
  today,
  bookings,
  onSelectSlot,
  onSelectBooking,
}: Props) {
  const slots = useMemo(() => slotsForSalon(salon), [salon]);

  // Cancelled bookings free their slot immediately — the same rule the
  // database constraints use — so they are simply not drawn.
  const active = useMemo(
    () => bookings.filter((b) => b.status !== "cancelled"),
    [bookings],
  );

  const byStart = useMemo(() => {
    const map = new Map<number, BookingDTO>();
    for (const b of active) map.set(b.startMin, b);
    return map;
  }, [active]);

  /** Slots swallowed by a longer booking that started earlier. */
  const covered = useMemo(() => {
    const set = new Set<number>();
    for (const b of active) {
      for (
        let t = b.startMin + salon.slotMin;
        t < b.startMin + b.durationMin;
        t += salon.slotMin
      ) {
        set.add(t);
      }
    }
    return set;
  }, [active, salon.slotMin]);

  const nowMin = date === today ? nowMinutesInSalonTz() : null;

  if (slots.length === 0) {
    return (
      <p className="panel rounded-xl p-6 text-sm">
        Les horaires de ce salon ne définissent aucun créneau.
      </p>
    );
  }

  return (
    <div
      className="panel overflow-hidden rounded-xl"
      role="grid"
      aria-label={`Créneaux du ${date}`}
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: "4.75rem 1fr", gridAutoRows: "minmax(3.5rem, auto)" }}
      >
        {slots.map((startMin, index) => {
          const row = index + 1;
          const booking = byStart.get(startMin);
          const isCovered = covered.has(startMin);
          const isPast = nowMin !== null && startMin + salon.slotMin <= nowMin;
          const isCurrent =
            nowMin !== null &&
            startMin <= nowMin &&
            nowMin < startMin + salon.slotMin;

          return (
            <div key={startMin} className="contents">
              <div
                className="flex items-start justify-end border-t px-3 pt-3 text-xs font-medium tabular-nums"
                style={{
                  gridColumn: 1,
                  gridRow: row,
                  borderColor: "var(--panel-border)",
                  color: isCurrent ? "var(--color-brand-600)" : "var(--text-muted)",
                  fontWeight: isCurrent ? 700 : 500,
                }}
              >
                {minutesToLabel(startMin)}
              </div>

              {isCovered ? null : booking ? (
                <BookingCard
                  booking={booking}
                  row={row}
                  span={Math.max(
                    1,
                    Math.ceil(booking.durationMin / salon.slotMin),
                  )}
                  onSelect={() => onSelectBooking(booking)}
                />
              ) : (
                <FreeSlot
                  row={row}
                  isPast={isPast}
                  label={minutesToLabel(startMin)}
                  onSelect={() => onSelectSlot(startMin)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FreeSlot({
  row,
  isPast,
  label,
  onSelect,
}: {
  row: number;
  isPast: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group border-t border-l px-3 text-left text-sm transition"
      style={{
        gridColumn: 2,
        gridRow: row,
        borderColor: "var(--panel-border)",
        background: isPast ? "var(--slot-past)" : "var(--slot-free)",
      }}
      aria-label={`Réserver le créneau de ${label}`}
    >
      <span
        className="opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ color: "var(--text-muted)" }}
      >
        + Réserver
      </span>
    </button>
  );
}

function BookingCard({
  booking,
  row,
  span,
  onSelect,
}: {
  booking: BookingDTO;
  row: number;
  span: number;
  onSelect: () => void;
}) {
  const style = STATUS_STYLES[booking.status as keyof typeof STATUS_STYLES];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`m-1 flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition hover:brightness-[0.98] ${style.card}`}
      style={{ gridColumn: 2, gridRow: `${row} / span ${span}` }}
    >
      <div className="flex w-full items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
        <span className="truncate text-sm font-semibold">
          {booking.clientName}
        </span>
        <span
          className="ml-auto shrink-0 text-xs tabular-nums"
          style={{ color: "var(--text-muted)" }}
        >
          {booking.durationMin} min
        </span>
      </div>
      <span className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
        {booking.service} · {formatPhoneForDisplay(booking.clientPhone)}
      </span>
      {booking.notes ? (
        <span
          className="mt-0.5 line-clamp-2 text-xs italic"
          style={{ color: "var(--text-muted)" }}
        >
          {booking.notes}
        </span>
      ) : null}
      <span className="sr-only">{style.label}</span>
    </button>
  );
}

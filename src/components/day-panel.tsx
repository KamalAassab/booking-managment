"use client";

import { CompactBooking } from "@/components/booking-card";
import { ArrowUpRight, Plus } from "@/components/icons";
import { bookingPhase, occupancy } from "@/lib/day-layout";
import { formatDayTitle, relativeDayLabel } from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";

type Props = {
  salon: SalonDTO;
  date: string;
  today: string;
  nowMin: number;
  /** The selected day's bookings, cancelled ones already removed. */
  bookings: BookingDTO[];
  loading: boolean;
  onOpenDay: () => void;
  onCreate: () => void;
  onSelectBooking: (booking: BookingDTO) => void;
};

/** The day picked in the month grid: its bookings, and the way into it. */
export function DayPanel({
  salon,
  date,
  today,
  nowMin,
  bookings,
  loading,
  onOpenDay,
  onCreate,
  onSelectBooking,
}: Props) {
  const sorted = [...bookings].sort((a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id));
  const relative = relativeDayLabel(date, today);
  const isPast = date < today;

  return (
    <section className="card flex flex-col p-4" aria-label="Journée sélectionnée">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="t-heading first-letter:uppercase">{formatDayTitle(date, today)}</h2>
          <p className="t-small" style={{ color: "var(--ink-faint)" }} data-nums>
            {loading && sorted.length === 0
              ? "Chargement"
              : sorted.length === 0
                ? "Aucun rendez-vous"
                : `${sorted.length} rendez-vous · ${occupancy(sorted, salon)} % occupé`}
          </p>
        </div>
        {relative ? <span className="chip chip-accent shrink-0">{relative}</span> : null}
      </div>

      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-secondary btn-sm flex-1" onClick={onOpenDay}>
          Ouvrir la journée
          <ArrowUpRight size={15} />
        </button>
        {!isPast ? (
          <button type="button" className="btn-primary btn-sm" onClick={onCreate}>
            <Plus size={16} />
            Réserver
          </button>
        ) : null}
      </div>

      {loading && sorted.length === 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="skeleton h-[50px]" />
          <div className="skeleton h-[50px]" />
        </div>
      ) : sorted.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-1.5">
          {sorted.map((b) => (
            <li key={b.id}>
              <CompactBooking
                booking={b}
                phase={bookingPhase(b, today, nowMin)}
                nowMin={nowMin}
                onSelect={() => onSelectBooking(b)}
              />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

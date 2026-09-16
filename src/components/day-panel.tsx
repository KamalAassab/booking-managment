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

/**
 * How many bookings the panel shows before handing over to the day view.
 *
 * A busy day here is ~100 bookings. Listing them all turned the month screen
 * into seven screens of scrolling underneath a calendar that is the reason
 * you opened it, so the panel previews the day and "Ouvrir la journée" —
 * which is right there — shows the rest.
 */
const PREVIEW = 6;

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

  // On today the useful end of the list is what has not happened yet, so the
  // preview starts at the next booking rather than at breakfast.
  const from =
    date === today
      ? Math.max(0, sorted.findIndex((b) => b.startMin + b.durationMin > nowMin))
      : 0;
  const preview = sorted.slice(from, from + PREVIEW);
  const hidden = sorted.length - preview.length;

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
      ) : preview.length > 0 ? (
        <>
          <ol className="mt-3 flex flex-col gap-1.5">
            {preview.map((b) => (
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
          {hidden > 0 ? (
            <button
              type="button"
              onClick={onOpenDay}
              className="btn-quiet btn-sm mt-2 w-full justify-center"
            >
              <span data-nums>+ {hidden}</span>
              {hidden > 1 ? " autres rendez-vous" : " autre rendez-vous"}
              <ArrowUpRight size={14} />
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

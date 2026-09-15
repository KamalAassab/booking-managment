"use client";

import { useMemo } from "react";

import { CompactBooking } from "@/components/booking-card";
import { Plus } from "@/components/icons";
import {
  bookingPhase,
  firstOpenSlotStart,
  formatDuration,
  freeWindows,
  occupancy,
  peakConcurrency,
} from "@/lib/day-layout";
import { minutesToLabel } from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";

type Props = {
  salon: SalonDTO;
  date: string;
  today: string;
  nowMin: number;
  /** The day's bookings, cancelled ones already removed. */
  bookings: BookingDTO[];
  loading: boolean;
  onSelectSlot: (startMin: number) => void;
  onSelectBooking: (booking: BookingDTO) => void;
};

const NEXT_LIMIT = 5;
const FREE_LIMIT = 6;

/**
 * Beside the timeline on wide screens, the answers the front desk looks up
 * all day without reading the whole axis: who is in the chair now, who is
 * next and in how long, and where the next free moments are.
 */
export function DayRail({
  salon,
  date,
  today,
  nowMin,
  bookings,
  loading,
  onSelectSlot,
  onSelectBooking,
}: Props) {
  const isToday = date === today;
  const isPastDay = date < today;

  const sorted = useMemo(
    () => [...bookings].sort((a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id)),
    [bookings],
  );

  const stats = useMemo(() => {
    let done = 0;
    let running = 0;
    let upcoming = 0;
    for (const b of sorted) {
      const phase = bookingPhase(b, today, nowMin);
      if (phase === "done") done += 1;
      else if (phase === "running") running += 1;
      else if (phase === "upcoming") upcoming += 1;
    }
    return {
      done,
      running,
      upcoming,
      peak: peakConcurrency(sorted),
      occupancy: occupancy(sorted, salon),
    };
  }, [sorted, salon, today, nowMin]);

  const runningNow = isToday ? sorted.filter((b) => bookingPhase(b, today, nowMin) === "running") : [];
  const next = isPastDay
    ? []
    : sorted.filter((b) => bookingPhase(b, today, nowMin) === "upcoming").slice(0, NEXT_LIMIT);
  const windows = isPastDay
    ? []
    : freeWindows(sorted, salon, isToday ? firstOpenSlotStart(salon, nowMin) : salon.opensAtMin).slice(
        0,
        FREE_LIMIT,
      );

  return (
    <div className="flex flex-col gap-3">
      <section className="card p-4" aria-label="Résumé de la journée">
        <div className="flex items-baseline justify-between gap-3">
          <p>
            <span className="t-display text-[30px] leading-8" data-nums>
              {loading && bookings.length === 0 ? "…" : sorted.length}
            </span>{" "}
            <span className="t-small" style={{ color: "var(--ink-soft)" }}>
              rendez-vous
            </span>
          </p>
          <p className="t-small" style={{ color: "var(--ink-faint)" }} data-nums>
            {stats.occupancy} % occupé
          </p>
        </div>
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full"
          style={{ background: "var(--surface-sunk)" }}
          role="img"
          aria-label={`Journée occupée à ${stats.occupancy} %`}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${stats.occupancy}%`, background: "var(--accent)" }}
          />
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="En cours" value={stats.running} />
          <Stat label="À venir" value={stats.upcoming} />
          <Stat label="Terminés" value={stats.done} />
        </dl>
        {stats.peak.count > 1 && stats.peak.atMin !== null ? (
          <p className="t-small mt-3 border-t pt-3" style={{ borderColor: "var(--line)", color: "var(--ink-soft)" }}>
            Jusqu&apos;à <strong data-nums>{stats.peak.count}</strong> rendez-vous en même temps, à{" "}
            <span data-nums>{minutesToLabel(stats.peak.atMin)}</span>
          </p>
        ) : null}
      </section>

      {isToday ? (
        <RailSection title="En ce moment" count={runningNow.length}>
          {runningNow.length === 0 ? (
            <Empty>Aucun rendez-vous en cours.</Empty>
          ) : (
            runningNow.map((b) => (
              <CompactBooking
                key={b.id}
                booking={b}
                phase="running"
                nowMin={nowMin}
                detail="countdown"
                onSelect={() => onSelectBooking(b)}
              />
            ))
          )}
        </RailSection>
      ) : null}

      {!isPastDay ? (
        <RailSection title={isToday ? "À suivre" : "Au programme"}>
          {next.length === 0 ? (
            <Empty>{isToday ? "Plus rien de prévu aujourd'hui." : "Rien de prévu pour l'instant."}</Empty>
          ) : (
            next.map((b) => (
              <CompactBooking
                key={b.id}
                booking={b}
                phase="upcoming"
                nowMin={nowMin}
                detail={isToday ? "countdown" : "duration"}
                onSelect={() => onSelectBooking(b)}
              />
            ))
          )}
        </RailSection>
      ) : null}

      {!isPastDay ? (
        <RailSection title="Moments libres">
          {windows.length === 0 ? (
            <Empty>Aucun moment sans rendez-vous d&apos;ici la fermeture.</Empty>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {windows.map((w) => (
                <li key={w.startMin}>
                  <button
                    type="button"
                    onClick={() => onSelectSlot(w.startMin)}
                    className="rail-free"
                    aria-label={`Réserver à ${minutesToLabel(w.startMin)}, libre jusqu'à ${minutesToLabel(w.endMin)}`}
                  >
                    <span className="min-w-0 flex-1 truncate" data-nums>
                      <strong className="font-semibold" style={{ color: "var(--ink)" }}>
                        {minutesToLabel(w.startMin)}
                      </strong>{" "}
                      à {minutesToLabel(w.endMin)}
                    </span>
                    <span className="shrink-0 text-[12px]" style={{ color: "var(--ink-faint)" }} data-nums>
                      {formatDuration(w.endMin - w.startMin)}
                    </span>
                    <span className="shrink-0" style={{ color: "var(--accent-ink)" }}>
                      <Plus size={16} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse rounded-[8px] py-2" style={{ background: "var(--surface-sunk)" }}>
      <dt className="text-[11.5px] leading-4" style={{ color: "var(--ink-soft)" }}>
        {label}
      </dt>
      <dd className="text-[17px] font-semibold leading-5" data-nums>
        {value}
      </dd>
    </div>
  );
}

function RailSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-3" aria-label={title}>
      <h2 className="mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
        {title}
        {count ? (
          <span className="chip chip-accent" data-nums>
            {count}
          </span>
        ) : null}
      </h2>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="t-small px-1 pb-1" style={{ color: "var(--ink-faint)" }}>
      {children}
    </p>
  );
}

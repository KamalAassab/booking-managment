"use client";

import { useMemo, useState } from "react";

import { AgendaBooking } from "@/components/booking-card";
import { ChevronDown, Plus } from "@/components/icons";
import {
  bookingPhase,
  firstOpenSlotStart,
  formatDuration,
  freeWindows,
} from "@/lib/day-layout";
import type { ServiceCatalogEntry } from "@/lib/services-catalog";
import { minutesToLabel } from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";

type Props = {
  salon: SalonDTO;
  date: string;
  today: string;
  nowMin: number;
  /** The day's bookings, cancelled ones already removed. */
  bookings: BookingDTO[];
  catalog: readonly ServiceCatalogEntry[];
  /** Ids matching the search box, or null when nothing is searched. */
  matches: Set<string> | null;
  query: string;
  loading: boolean;
  onSelectSlot: (startMin: number) => void;
  onSelectBooking: (booking: BookingDTO) => void;
};

type Entry =
  | { kind: "group"; key: string; sort: number; startMin: number; bookings: BookingDTO[] }
  | { kind: "free"; key: string; sort: number; startMin: number; endMin: number }
  | { kind: "now"; key: string; sort: number };

const ORDER: Record<Entry["kind"], number> = { now: 0, free: 1, group: 2 };

/**
 * The day as a list, for screens too narrow for a time axis. Chronological,
 * with the three things a phone user at the desk looks for made explicit:
 * a "now" line, services that start together grouped under one time, and
 * the free stretches between bookings as rows that book them. On today,
 * what has already finished folds away so the list opens on what is next.
 */
export function DayAgenda({
  salon,
  date,
  today,
  nowMin,
  bookings,
  catalog,
  matches,
  query,
  loading,
  onSelectSlot,
  onSelectBooking,
}: Props) {
  const isToday = date === today;
  const isPastDay = date < today;
  const [showFinished, setShowFinished] = useState(false);

  const sorted = useMemo(
    () =>
      [...bookings].sort(
        (a, b) => a.startMin - b.startMin || b.durationMin - a.durationMin || a.id.localeCompare(b.id),
      ),
    [bookings],
  );

  const visible = useMemo(
    () => (matches ? sorted.filter((b) => matches.has(b.id)) : sorted),
    [sorted, matches],
  );
  const finishedCount = isToday && !matches
    ? visible.filter((b) => b.startMin + b.durationMin <= nowMin).length
    : 0;
  const folded = finishedCount > 0 && !showFinished;

  const entries = useMemo(() => {
    const out: Entry[] = [];
    const listed = folded ? visible.filter((b) => b.startMin + b.durationMin > nowMin) : visible;

    let group: Extract<Entry, { kind: "group" }> | null = null;
    for (const booking of listed) {
      if (group && group.startMin === booking.startMin) {
        group.bookings.push(booking);
        continue;
      }
      group = {
        kind: "group",
        key: `g${booking.startMin}`,
        sort: booking.startMin,
        startMin: booking.startMin,
        bookings: [booking],
      };
      out.push(group);
    }

    if (!isPastDay && !matches) {
      const from = isToday ? firstOpenSlotStart(salon, nowMin) : salon.opensAtMin;
      for (const w of freeWindows(bookings, salon, from)) {
        out.push({
          kind: "free",
          key: `f${w.startMin}`,
          sort: isToday ? Math.max(w.startMin, nowMin) : w.startMin,
          startMin: w.startMin,
          endMin: w.endMin,
        });
      }
    }

    if (isToday && !matches && nowMin >= salon.opensAtMin && nowMin < salon.closesAtMin) {
      out.push({ kind: "now", key: "now", sort: nowMin });
    }

    return out.sort((a, b) => a.sort - b.sort || ORDER[a.kind] - ORDER[b.kind]);
  }, [visible, folded, isPastDay, isToday, matches, bookings, salon, nowMin]);

  if (loading && bookings.length === 0) {
    return (
      <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="Chargement du planning">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="skeleton h-5 w-[48px]" />
            <div className="skeleton h-[68px] flex-1 rounded-[10px]" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {matches && visible.length === 0 ? (
        <p className="card px-4 py-5 text-center t-small" style={{ color: "var(--ink-soft)" }}>
          Aucun rendez-vous ne correspond à « {query.trim()} » ce jour.
        </p>
      ) : null}

      {!matches && bookings.length === 0 ? (
        <p className="t-small px-1" style={{ color: "var(--ink-faint)" }}>
          {isPastDay ? "Aucun rendez-vous ce jour-là." : "Aucun rendez-vous pour le moment."}
        </p>
      ) : null}

      {finishedCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowFinished((v) => !v)}
          aria-expanded={showFinished}
          className="btn-secondary btn-sm w-full justify-between"
        >
          <span>
            {showFinished ? "Masquer" : "Afficher"} {finishedCount}{" "}
            {finishedCount > 1 ? "rendez-vous passés" : "rendez-vous passé"}
          </span>
          <ChevronDown size={16} className={showFinished ? "rotate-180" : undefined} />
        </button>
      ) : null}

      <ol className="flex flex-col gap-2.5">
        {entries.map((entry) => {
          if (entry.kind === "now") {
            return (
              <li key={entry.key} className="flex items-center gap-3 py-0.5">
                <span className="w-[48px] shrink-0 text-right">
                  <span className="now-pill" data-nums>
                    {minutesToLabel(nowMin)}
                  </span>
                </span>
                <span className="h-[2px] flex-1 rounded-full" style={{ background: "var(--accent)" }} />
                <span className="sr-only">Maintenant</span>
              </li>
            );
          }

          if (entry.kind === "free") {
            const start = entry.startMin;
            return (
              <li key={entry.key} className="flex gap-3">
                <span
                  className="w-[48px] shrink-0 pt-[13px] text-right text-[13px] font-medium"
                  style={{ color: "var(--ink-faint)" }}
                  data-nums
                >
                  {minutesToLabel(start)}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectSlot(start)}
                  className="agenda-free"
                  aria-label={`Réserver à ${minutesToLabel(start)}, libre jusqu'à ${minutesToLabel(entry.endMin)}`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    Libre jusqu&apos;à <span data-nums>{minutesToLabel(entry.endMin)}</span>
                    <span data-nums style={{ color: "var(--ink-faint)" }}>
                      {" "}· {formatDuration(entry.endMin - start)}
                    </span>
                  </span>
                  <span className="agenda-free-cta">
                    <Plus size={16} />
                    Réserver
                  </span>
                </button>
              </li>
            );
          }

          const parallel = entry.bookings.length;
          return (
            <li key={entry.key} className="flex gap-3">
              <span className="w-[48px] shrink-0 pt-3 text-right">
                <span className="block text-[15px] font-semibold leading-5" data-nums>
                  {minutesToLabel(entry.startMin)}
                </span>
                {parallel > 1 ? (
                  <span className="mt-0.5 block text-[11.5px] leading-4" style={{ color: "var(--ink-faint)" }}>
                    {parallel} rdv
                  </span>
                ) : null}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {entry.bookings.map((booking) => (
                  <AgendaBooking
                    key={booking.id}
                    booking={booking}
                    phase={bookingPhase(booking, today, nowMin)}
                    salon={salon}
                    catalog={catalog}
                    nowMin={nowMin}
                    onSelect={() => onSelectBooking(booking)}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

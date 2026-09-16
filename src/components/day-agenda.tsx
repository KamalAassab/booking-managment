"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AgendaRow } from "@/components/booking-card";
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

/** One hour of the day, with everything that happens inside it. */
type Section = { hour: number; entries: Entry[]; count: number };

const ORDER: Record<Entry["kind"], number> = { now: 0, free: 1, group: 2 };

const hourId = (hour: number) => `agenda-h${hour}`;

/**
 * The day as a list, for screens too narrow for a time axis.
 *
 * A salon here books up to 110 appointments in a day, which as one flat list
 * of cards was seven screens of scrolling with no way to tell where you were
 * in it. So the list is cut into hours: a sticky bar of hour chips jumps
 * straight to any of them and highlights the one you are looking at, each
 * hour can be folded away, and appointments that start together sit under a
 * single time marker inside one bracket, which is what tells the desk they
 * run in parallel rather than back to back. On today, what has already
 * finished folds away so the list opens on what is next.
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const [activeHour, setActiveHour] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const jumpRef = useRef<HTMLElement>(null);

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

  /** The same entries, cut into the hour each one falls in. */
  const sections = useMemo(() => {
    const byHour = new Map<number, Section>();
    for (const entry of entries) {
      const hour = Math.floor(entry.sort / 60);
      let section = byHour.get(hour);
      if (!section) {
        section = { hour, entries: [], count: 0 };
        byHour.set(hour, section);
      }
      section.entries.push(entry);
      if (entry.kind === "group") section.count += entry.bookings.length;
    }
    return [...byHour.values()].sort((a, b) => a.hour - b.hour);
  }, [entries]);

  /** Hours worth a jump chip — the ones that actually hold appointments. */
  const jumpHours = useMemo(
    () => sections.filter((s) => s.count > 0).map((s) => ({ hour: s.hour, count: s.count })),
    [sections],
  );

  // Which hour is on screen, so the chip bar doubles as "where am I".
  useEffect(() => {
    const root = listRef.current;
    if (!root || jumpHours.length === 0) return;

    const observer = new IntersectionObserver(
      (records) => {
        const onScreen = records
          .filter((r) => r.isIntersecting)
          .map((r) => Number((r.target as HTMLElement).dataset.hour));
        if (onScreen.length > 0) setActiveHour(Math.min(...onScreen));
      },
      // The sticky chrome covers the top of the viewport, so a section only
      // counts as "on screen" once it clears it.
      { rootMargin: "-190px 0px -55% 0px", threshold: 0 },
    );

    for (const el of root.querySelectorAll<HTMLElement>("[data-hour]")) observer.observe(el);
    return () => observer.disconnect();
  }, [jumpHours, sections]);

  // Keep the hour you are in inside the strip, so the bar stays an answer to
  // "where am I" and not just a row of buttons that scrolled out of reach.
  // Scrolled by hand rather than scrollIntoView, which would also drag the
  // page vertically and fight the scroll that triggered this.
  useEffect(() => {
    const nav = jumpRef.current;
    if (!nav || activeHour === null) return;
    const chip = nav.querySelector<HTMLElement>(`[data-chip="${activeHour}"]`);
    if (!chip) return;
    const target = chip.offsetLeft - nav.clientWidth / 2 + chip.offsetWidth / 2;
    nav.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [activeHour]);

  function jumpTo(hour: number) {
    setCollapsed((prev) => {
      if (!prev.has(hour)) return prev;
      const next = new Set(prev);
      next.delete(hour);
      return next;
    });
    setActiveHour(hour);
    // Let an expanded section lay out before scrolling to it.
    requestAnimationFrame(() => {
      document.getElementById(hourId(hour))?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function toggleHour(hour: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(hour)) next.delete(hour);
      else next.add(hour);
      return next;
    });
  }

  if (loading && bookings.length === 0) {
    return (
      <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="Chargement du planning">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="skeleton h-5 w-[48px]" />
            <div className="skeleton h-[56px] flex-1 rounded-[10px]" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
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

      {jumpHours.length > 1 ? (
        <nav className="agenda-jump" aria-label="Aller à une heure" ref={jumpRef}>
          {jumpHours.map(({ hour, count }) => (
            <button
              key={hour}
              type="button"
              onClick={() => jumpTo(hour)}
              className="agenda-jump-chip"
              data-chip={hour}
              aria-current={activeHour === hour ? "true" : undefined}
              data-collapsed={collapsed.has(hour) ? "true" : undefined}
            >
              <span data-nums>{hour}h</span>
              <span className="agenda-jump-n" data-nums>
                {count}
              </span>
            </button>
          ))}
        </nav>
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

      <div ref={listRef} className="flex flex-col gap-1">
        {sections.map((section) => {
          const isCollapsed = collapsed.has(section.hour);
          return (
            <section
              key={section.hour}
              id={hourId(section.hour)}
              data-hour={section.hour}
              className="agenda-sec"
            >
              <button
                type="button"
                className="agenda-sec-head"
                onClick={() => toggleHour(section.hour)}
                aria-expanded={!isCollapsed}
                aria-controls={`${hourId(section.hour)}-body`}
              >
                <span className="agenda-sec-hour" data-nums>
                  {section.hour}h
                </span>
                <span className="agenda-sec-rule" aria-hidden />
                {section.count > 0 ? (
                  <span className="agenda-sec-n" data-nums>
                    {section.count} rdv
                  </span>
                ) : null}
                <ChevronDown
                  size={15}
                  className={isCollapsed ? "-rotate-90" : undefined}
                />
              </button>

              {isCollapsed ? null : (
                <ol id={`${hourId(section.hour)}-body`} className="flex flex-col gap-1.5 pb-1">
                  {section.entries.map((entry) => {
                    if (entry.kind === "now") {
                      return (
                        <li key={entry.key} className="flex items-center gap-2 py-0.5">
                          <span className="w-[46px] shrink-0 text-right">
                            <span className="now-pill" data-nums>
                              {minutesToLabel(nowMin)}
                            </span>
                          </span>
                          <span
                            className="h-[2px] flex-1 rounded-full"
                            style={{ background: "var(--accent)" }}
                          />
                          <span className="sr-only">Maintenant</span>
                        </li>
                      );
                    }

                    if (entry.kind === "free") {
                      return (
                        <li key={entry.key} className="flex gap-2">
                          <span
                            className="w-[46px] shrink-0 pt-[11px] text-right text-[12.5px] font-medium"
                            style={{ color: "var(--ink-faint)" }}
                            data-nums
                          >
                            {minutesToLabel(entry.startMin)}
                          </span>
                          <button
                            type="button"
                            onClick={() => onSelectSlot(entry.startMin)}
                            className="agenda-free"
                            aria-label={`Réserver à ${minutesToLabel(entry.startMin)}, libre jusqu'à ${minutesToLabel(entry.endMin)}`}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              Libre jusqu&apos;à <span data-nums>{minutesToLabel(entry.endMin)}</span>
                              <span data-nums style={{ color: "var(--ink-faint)" }}>
                                {" "}· {formatDuration(entry.endMin - entry.startMin)}
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
                      <li
                        key={entry.key}
                        className="agenda-grp"
                        data-parallel={parallel > 1 ? "true" : undefined}
                      >
                        <span className="agenda-grp-time">
                          <span className="agenda-grp-at" data-nums>
                            {minutesToLabel(entry.startMin)}
                          </span>
                          {parallel > 1 ? (
                            <span className="agenda-grp-n" data-nums>
                              ×{parallel}
                            </span>
                          ) : null}
                        </span>
                        <div className="agenda-grp-rows">
                          {parallel > 1 ? (
                            <span className="sr-only">
                              {parallel} rendez-vous en parallèle à {minutesToLabel(entry.startMin)}
                            </span>
                          ) : null}
                          {entry.bookings.map((booking) => (
                            <AgendaRow
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
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

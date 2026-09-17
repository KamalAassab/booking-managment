"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";

import { CompactBooking, TimelineBooking } from "@/components/booking-card";
import { Plus } from "@/components/icons";
import { bookingPhase, layoutDay, timelineBounds } from "@/lib/day-layout";
import { isSlotOver, minutesToLabel } from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";

type Props = {
  salon: SalonDTO;
  date: string;
  today: string;
  nowMin: number;
  /** The day's bookings, cancelled ones already removed. */
  bookings: BookingDTO[];
  /** Ids matching the search box, or null when nothing is searched. */
  matches: Set<string> | null;
  loading: boolean;
  /** A create/edit sheet is open elsewhere on the board: any overflow badge
   *  popover here must close rather than sit open behind it — a popover left
   *  open is a mistake this component owns, not something z-index should
   *  have to paper over. */
  sheetOpen: boolean;
  onSelectSlot: (startMin: number) => void;
  onSelectBooking: (booking: BookingDTO) => void;
};

/** Time labels, left. */
const RAIL_PX = 60;
/** Right-hand strip that always leaves every row reachable, even when all
 *  lanes at that time are full: a different service can still start there. */
const GUTTER_PX = 44;
/** Narrowest lane before the canvas scrolls sideways instead of squeezing.
 *  Wide enough that a name and its service both fit on one line without
 *  turning to soup. */
const LANE_MIN_PX = 172;
/** Columns a single instant may ever show side by side. A cluster busier than
 *  this collapses the rest into a "+N" badge rather than lanes too thin to
 *  read — four wide cards beat eleven slivers. */
const LANE_CAP = 4;
/** Room above the first hour line and below the last, for their labels. */
const PAD_Y = 12;

/** 48px per half hour: a 30-minute booking has room for a name and a service. */
export function rowHeightFor(slotMin: number): number {
  return Math.max(40, Math.round(slotMin * 1.6));
}

/**
 * The day as a time axis. Height is duration, so a 2-hour colour and a
 * 20-minute brushing look like what they are, and services running at the
 * same time stand side by side in lanes (see lib/day-layout.ts) instead of
 * hiding one another. Every free row is a button that books that time.
 */
export function DayTimeline({
  salon,
  date,
  today,
  nowMin,
  bookings,
  matches,
  loading,
  sheetOpen,
  onSelectSlot,
  onSelectBooking,
}: Props) {
  const slotMin = Math.max(5, salon.slotMin);
  const rowPx = rowHeightFor(slotMin);
  const pxPerMin = rowPx / slotMin;

  const { items, overflow, maxLanes } = useMemo(
    () => layoutDay(bookings, slotMin, LANE_CAP),
    [bookings, slotMin],
  );
  const bounds = useMemo(() => timelineBounds(salon, bookings), [salon, bookings]);
  const [openOverflow, setOpenOverflow] = useState<number | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const out: number[] = [];
    for (let t = bounds.startMin; t < bounds.endMin; t += slotMin) out.push(t);
    return out;
  }, [bounds, slotMin]);

  const isToday = date === today;
  const isPastDay = date < today;
  const y = (minute: number) => PAD_Y + (minute - bounds.startMin) * pxPerMin;
  const canvasHeight = rows.length * rowPx + PAD_Y * 2;
  const nowY = isToday && nowMin >= bounds.startMin && nowMin <= bounds.endMin ? y(nowMin) : null;
  const minWidth = RAIL_PX + 8 + Math.max(1, maxLanes) * LANE_MIN_PX + GUTTER_PX;

  // Lands on what matters when a day opens: the present on today, the first
  // booking on any other day. Only when the day changes (or its data first
  // arrives), never while the agent is scrolling and the poll updates.
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstStart = bookings.length > 0 ? Math.min(...bookings.map((b) => b.startMin)) : null;
  const focusDay = useEffectEvent(() => {
    const el = scrollRef.current;
    if (!el) return;
    const focusMin = isToday ? nowMin - 60 : firstStart !== null ? firstStart - 30 : salon.opensAtMin;
    el.scrollTop = Math.max(0, y(focusMin) - PAD_Y);
  });
  useLayoutEffect(() => {
    focusDay();
  }, [salon.slug, date, loading]);

  useLayoutEffect(() => {
    setOpenOverflow(null);
  }, [salon.slug, date, sheetOpen]);

  useEffect(() => {
    if (openOverflow === null) return;
    function handlePointer(event: MouseEvent) {
      if (popRef.current && !popRef.current.contains(event.target as Node)) {
        setOpenOverflow(null);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenOverflow(null);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openOverflow]);

  if (rows.length === 0) {
    return (
      <p className="card p-5" style={{ color: "var(--ink-soft)" }}>
        Les horaires de ce salon ne définissent aucun créneau.
      </p>
    );
  }

  return (
    <section
      className="card relative flex min-h-0 flex-1 flex-col overflow-hidden p-0"
      aria-label="Planning de la journée"
    >
      <div ref={scrollRef} className="tl-scroll relative min-h-0 flex-1 overflow-auto overscroll-contain">
        {!loading && (isPastDay || bookings.length === 0) ? (
          <div className="pointer-events-none sticky left-0 top-0 z-[13] h-0">
            <p
              className="chip pointer-events-auto mx-auto mt-3 w-fit px-3 py-1.5 text-[12.5px] shadow-[var(--shadow-card)]"
              style={{ background: "var(--surface)", minHeight: 30 }}
              role="status"
            >
              {isPastDay
                ? bookings.length === 0
                  ? "Journée passée, aucun rendez-vous"
                  : "Journée passée, consultation seulement"
                : "Aucun rendez-vous. Cliquez sur une heure pour réserver."}
            </p>
          </div>
        ) : null}

        <div className="relative flex" style={{ minWidth, height: canvasHeight }}>
          {/* Hour rail. Sticky, so the times stay put when many lanes scroll
              the canvas sideways. */}
          <div
            className="sticky left-0 z-[12] shrink-0 border-r"
            style={{ width: RAIL_PX, background: "var(--surface)", borderColor: "var(--line)" }}
            aria-hidden
          >
            {rows.map((t) =>
              t % 60 === 0 && !(nowY !== null && Math.abs(y(t) - (nowY ?? 0)) < 11) ? (
                <span key={t} className="tl-hour" style={{ top: y(t) }} data-nums>
                  {minutesToLabel(t)}
                </span>
              ) : null,
            )}
            {bounds.endMin % 60 === 0 ? (
              <span className="tl-hour" style={{ top: y(bounds.endMin) }} data-nums>
                {minutesToLabel(bounds.endMin)}
              </span>
            ) : null}
            {nowY !== null ? (
              <span className="tl-now-label" style={{ top: nowY }} data-nums>
                {minutesToLabel(nowMin)}
              </span>
            ) : null}
          </div>

          <div className="relative flex-1">
            {/* Bookings first in the DOM, so Tab reaches them before the
                empty rows; they paint above the rows through z-index. */}
            <div
              className="pointer-events-none absolute inset-y-0 z-[2]"
              style={{ left: 6, right: GUTTER_PX }}
            >
              {items.map((item) => {
                const phase = bookingPhase(item.booking, today, nowMin);
                return (
                  <div
                    key={item.booking.id}
                    className="bk-slot pointer-events-auto"
                    data-dim={matches ? !matches.has(item.booking.id) : undefined}
                    style={{
                      top: y(item.top) + 1,
                      height: (item.bottom - item.top) * pxPerMin - 3,
                      left: `calc(${(item.lane / item.lanes) * 100}% + 1px)`,
                      width: `calc(${(item.span / item.lanes) * 100}% - 4px)`,
                    }}
                  >
                    <TimelineBooking
                      booking={item.booking}
                      phase={phase}
                      nowMin={nowMin}
                      onSelect={() => onSelectBooking(item.booking)}
                    />
                  </div>
                );
              })}

              {overflow.map((group, index) => {
                const isOpen = openOverflow === index;
                const badgeHeight = Math.max(22, Math.min(30, (group.bottom - group.top) * pxPerMin - 3));
                const label = `${group.bookings.length} rendez-vous supplémentaires entre ${minutesToLabel(group.top)} et ${minutesToLabel(group.bottom)}`;
                return (
                  <div
                    key={`${group.top}-${group.bottom}-${index}`}
                    className="pointer-events-auto"
                    style={{ position: "absolute", top: y(group.top) + 1, right: 0 }}
                  >
                    <button
                      type="button"
                      className="tl-overflow"
                      data-open={isOpen || undefined}
                      style={{ height: badgeHeight, padding: "0 8px" }}
                      onClick={() => setOpenOverflow(isOpen ? null : index)}
                      aria-expanded={isOpen}
                      aria-label={label}
                      title={label}
                    >
                      +{group.bookings.length}
                    </button>
                    {isOpen ? (
                      <div
                        ref={popRef}
                        className="popover tl-overflow-pop"
                        style={{ top: badgeHeight + 4, right: 0 }}
                      >
                        <p className="t-small px-2 py-1.5" style={{ color: "var(--ink-faint)" }} data-nums>
                          {minutesToLabel(group.top)} – {minutesToLabel(group.bottom)} · {group.bookings.length} de plus
                        </p>
                        {[...group.bookings]
                          .sort((a, b) => a.startMin - b.startMin)
                          .map((booking) => (
                            <CompactBooking
                              key={booking.id}
                              booking={booking}
                              phase={bookingPhase(booking, today, nowMin)}
                              nowMin={nowMin}
                              detail="end"
                              onSelect={() => {
                                setOpenOverflow(null);
                                onSelectBooking(booking);
                              }}
                            />
                          ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {loading && bookings.length === 0
                ? [0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="skeleton absolute"
                      style={{
                        top: y(salon.opensAtMin + (i * 3 + 1) * slotMin) + 1,
                        height: rowPx * (i === 1 ? 2 : 1) - 3,
                        left: `${i * 18}%`,
                        width: "46%",
                      }}
                    />
                  ))
                : null}
            </div>

            {rows.map((t) => {
              const inHours = t >= salon.opensAtMin && t < salon.closesAtMin;
              const past = isPastDay || (isToday && isSlotOver(t, slotMin, nowMin));
              const common = {
                className: "tl-row",
                "data-hour": t % 60 === 0 ? "" : undefined,
                style: { top: y(t), height: rowPx },
              };
              if (!inHours || past) {
                return <div key={t} {...common} data-closed={inHours ? undefined : ""} aria-hidden />;
              }
              const label = minutesToLabel(t);
              return (
                <button
                  key={t}
                  type="button"
                  {...common}
                  onClick={() => onSelectSlot(t)}
                  aria-label={`Réserver à ${label}`}
                  title={`Réserver à ${label}`}
                >
                  <span className="tl-add" style={{ width: GUTTER_PX - 12 }}>
                    <Plus size={15} />
                  </span>
                </button>
              );
            })}

            {nowY !== null ? (
              <>
                <div
                  className="tl-past"
                  style={{ top: PAD_Y, height: Math.max(0, nowY - PAD_Y) }}
                  aria-hidden
                />
                <div className="tl-now" style={{ top: nowY }} aria-hidden />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

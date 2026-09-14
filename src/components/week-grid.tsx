"use client";

import { useMemo } from "react";

import { addDays, minutesToLabel, nowMinutesInSalonTz, slotsForSalon } from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";

type Props = {
  salon: SalonDTO;
  date: string;
  today: string;
  bookingsByDate: Map<string, BookingDTO[]>;
  onSelectDate: (date: string) => void;
  onSelectSlot: (date: string, startMin: number) => void;
  onSelectBooking: (booking: BookingDTO) => void;
};

const ROW_PX = 44;
const RAIL_PX = 48;
/** Below this, a day column reading a client's name is not worth the squeeze. */
const COL_MIN_PX = 108;

const WEEKDAY_FMT = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  timeZone: "UTC",
});

function dayParts(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: WEEKDAY_FMT.format(dt).replace(".", "").toUpperCase(),
    day: String(d),
  };
}

/**
 * The week — seven day-columns sharing one time rail, for the staff member
 * who thinks in "this week" rather than one day at a time. Sunday first, so
 * it reads the same direction as the month view.
 */
export function WeekGrid({
  salon,
  date,
  today,
  bookingsByDate,
  onSelectDate,
  onSelectSlot,
  onSelectBooking,
}: Props) {
  const weekDates = useMemo(() => {
    const [y, m, d] = date.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return Array.from({ length: 7 }, (_, i) => addDays(date, i - weekday));
  }, [date]);

  const slots = useMemo(() => slotsForSalon(salon), [salon]);
  const nowMin = nowMinutesInSalonTz();

  const activeByDate = useMemo(() => {
    const map = new Map<string, Map<number, BookingDTO>>();
    for (const d of weekDates) {
      const byStart = new Map<number, BookingDTO>();
      for (const b of bookingsByDate.get(d) ?? []) {
        if (b.status !== "cancelled") byStart.set(b.startMin, b);
      }
      map.set(d, byStart);
    }
    return map;
  }, [weekDates, bookingsByDate]);

  const coveredByDate = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const [d, byStart] of activeByDate) {
      const set = new Set<number>();
      for (const b of byStart.values()) {
        for (
          let t = b.startMin + salon.slotMin;
          t < b.startMin + b.durationMin;
          t += salon.slotMin
        ) {
          set.add(t);
        }
      }
      map.set(d, set);
    }
    return map;
  }, [activeByDate, salon.slotMin]);

  if (slots.length === 0) {
    return (
      <p className="card p-5" style={{ color: "var(--ink-soft)" }}>
        Les horaires de ce salon ne définissent aucun créneau.
      </p>
    );
  }

  return (
    <section className="card overflow-hidden p-0">
      <div className="no-scrollbar overflow-x-auto">
        <div style={{ minWidth: RAIL_PX + weekDates.length * COL_MIN_PX }}>
          {/* Day headers */}
          <div
            className="grid border-b"
            style={{
              gridTemplateColumns: `${RAIL_PX}px repeat(${weekDates.length}, 1fr)`,
              borderColor: "var(--line)",
            }}
          >
            <div />
            {weekDates.map((d) => {
              const { weekday, day } = dayParts(d);
              const isToday = d === today;
              const isSelected = d === date;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => onSelectDate(d)}
                  aria-current={isSelected ? "date" : undefined}
                  className="flex flex-col items-center gap-0.5 py-2.5 transition-colors duration-[120ms]"
                  style={{
                    background: isToday
                      ? "var(--accent)"
                      : isSelected
                        ? "var(--accent-tint)"
                        : "transparent",
                  }}
                >
                  <span
                    className="text-[10.5px] font-semibold tracking-[0.03em]"
                    style={{
                      color: isToday ? "rgb(255 255 255 / 0.85)" : "var(--ink-faint)",
                    }}
                  >
                    {weekday}
                  </span>
                  <span
                    className="text-[13px] font-semibold"
                    style={{ color: isToday ? "#fff" : "var(--ink)" }}
                    data-nums
                  >
                    {day}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Grid body */}
          <div
            className="relative grid"
            style={{
              gridTemplateColumns: `${RAIL_PX}px repeat(${weekDates.length}, 1fr)`,
              gridAutoRows: `${ROW_PX}px`,
            }}
          >
            {slots.map((startMin, i) => {
              const isPast = startMin + salon.slotMin <= nowMin;
              return (
                <div
                  key={`rail-${startMin}`}
                  className="flex items-start justify-end pr-2 pt-1 text-[10.5px]"
                  style={{
                    gridColumn: 1,
                    gridRow: i + 1,
                    color: "var(--ink-faint)",
                    borderTop: i === 0 ? "none" : "1px solid var(--line)",
                    opacity: isPast ? 0.55 : 1,
                  }}
                  data-nums
                >
                  {minutesToLabel(startMin)}
                </div>
              );
            })}

            {weekDates.map((d, colIndex) => {
              const isPastDay = d < today;
              const byStart = activeByDate.get(d) ?? new Map();
              const covered = coveredByDate.get(d) ?? new Set();

              return (
                <div key={d} className="contents">
                  {slots.map((startMin, i) => (
                    <div
                      key={`bg-${d}-${startMin}`}
                      style={{
                        gridColumn: colIndex + 2,
                        gridRow: i + 1,
                        borderTop: i === 0 ? "none" : "1px solid var(--line)",
                        borderLeft: "1px solid var(--line)",
                      }}
                    />
                  ))}

                  {slots.map((startMin, i) => {
                    if (covered.has(startMin)) return null;
                    const booking = byStart.get(startMin);
                    const span = booking
                      ? Math.max(1, Math.ceil(booking.durationMin / salon.slotMin))
                      : 1;

                    if (!booking) {
                      const isPastSlot =
                        isPastDay ||
                        (d === today && startMin + salon.slotMin <= nowMin);
                      return (
                        <button
                          key={`slot-${d}-${startMin}`}
                          type="button"
                          onClick={isPastSlot ? undefined : () => onSelectSlot(d, startMin)}
                          disabled={isPastSlot}
                          aria-label={`Réserver le ${d} à ${minutesToLabel(startMin)}`}
                          className="m-0.5 rounded-[6px] transition-colors duration-[120ms] hover:bg-[color:var(--accent-tint)] disabled:cursor-default disabled:hover:bg-transparent"
                          style={{
                            gridColumn: colIndex + 2,
                            gridRow: i + 1,
                            opacity: isPastSlot ? 0.35 : 1,
                          }}
                        />
                      );
                    }

                    const done = booking.status === "done";
                    return (
                      <button
                        key={booking.id}
                        type="button"
                        onClick={() => onSelectBooking(booking)}
                        className="m-0.5 overflow-hidden rounded-[6px] px-1.5 py-1 text-left"
                        style={{
                          gridColumn: colIndex + 2,
                          gridRow: `${i + 1} / span ${span}`,
                          background: done ? "var(--surface-sunk)" : "var(--accent-tint)",
                          borderLeft: done
                            ? "1px solid var(--line)"
                            : "2.5px solid var(--accent)",
                        }}
                      >
                        <span
                          className="block truncate text-[10.5px] font-semibold"
                          style={{
                            color: done ? "var(--ink-faint)" : "var(--accent-hover)",
                          }}
                        >
                          {booking.clientName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import { useMemo } from "react";

import { DayPanel } from "@/components/day-panel";
import { occupancy } from "@/lib/day-layout";
import { addDays, formatMonthYear, formatShortDate, minutesToLabel, monthMatrix } from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";

type Props = {
  salon: SalonDTO;
  date: string;
  today: string;
  nowMin: number;
  /** Active bookings for every day on screen, keyed by date. */
  bookingsByDate: Map<string, BookingDTO[]>;
  loading: boolean;
  onSelectDate: (date: string) => void;
  onOpenDay: (date: string) => void;
  onCreateOn: (date: string) => void;
  onSelectBooking: (booking: BookingDTO) => void;
};

const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const NAMES_SHOWN = 2;

/**
 * The month as a grid of days, each saying how many bookings it has and how
 * full it is, and the selected day's bookings beside it (below it on a
 * phone). Tapping a day selects it; the panel opens it. Past days stay
 * legible: they are history staff look things up in, not disabled cells.
 */
export function MonthCalendar({
  salon,
  date,
  today,
  nowMin,
  bookingsByDate,
  loading,
  onSelectDate,
  onOpenDay,
  onCreateOn,
  onSelectBooking,
}: Props) {
  const cells = useMemo(() => monthMatrix(date), [date]);
  const { month, year } = useMemo(() => formatMonthYear(date), [date]);

  const moveSelection = (e: React.KeyboardEvent, delta: number) => {
    e.preventDefault();
    const next = addDays(date, delta);
    onSelectDate(next);
    // Focus follows the selection once the grid has re-rendered around it.
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus();
    });
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <section className="card min-w-0 flex-1 p-2 md:p-3" aria-label={`${month} ${year}`}>
        <div className="mb-1.5 grid grid-cols-7 gap-1 md:gap-1.5" aria-hidden>
          {WEEKDAYS.map((label) => (
            <div
              key={label}
              className="py-1 text-center text-[12px] font-semibold"
              style={{ color: "var(--ink-soft)" }}
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1 md:gap-1.5">
          {cells.map((cell) => {
            const dayBookings = bookingsByDate.get(cell.date) ?? [];
            const count = dayBookings.length;
            const selected = cell.date === date;
            const names = [...dayBookings]
              .sort((a, b) => a.startMin - b.startMin)
              .slice(0, NAMES_SHOWN);
            return (
              <button
                key={cell.date}
                type="button"
                data-cell={cell.date}
                onClick={() => onSelectDate(cell.date)}
                onDoubleClick={() => onOpenDay(cell.date)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") moveSelection(e, -1);
                  else if (e.key === "ArrowRight") moveSelection(e, 1);
                  else if (e.key === "ArrowUp") moveSelection(e, -7);
                  else if (e.key === "ArrowDown") moveSelection(e, 7);
                }}
                tabIndex={selected ? 0 : -1}
                className="mo-cell"
                aria-pressed={selected}
                data-today={cell.date === today ? "" : undefined}
                data-past={cell.date < today ? "" : undefined}
                data-out={cell.inMonth ? undefined : ""}
                aria-label={`${formatShortDate(cell.date)}, ${count === 0 ? "aucun rendez-vous" : `${count} rendez-vous`}`}
              >
                <span className="flex flex-col items-center gap-0.5 md:flex-row md:justify-between">
                  <span className="mo-num" data-nums>
                    {Number(cell.date.slice(8))}
                  </span>
                  <span
                    className="min-h-[14px] text-[11px] font-semibold leading-[14px] md:hidden"
                    style={{ color: "var(--accent-ink)" }}
                    data-nums
                  >
                    {count > 0 ? count : ""}
                  </span>
                </span>

                {count > 0 ? (
                  <>
                    <span className="hidden text-[12px] font-medium md:block" style={{ color: "var(--ink-soft)" }} data-nums>
                      {count} rdv
                    </span>
                    <span className="hidden flex-col gap-0.5 xl:flex">
                      {names.map((b) => (
                        <span key={b.id} className="truncate text-[11.5px] leading-4" style={{ color: "var(--ink-soft)" }}>
                          <span data-nums>{minutesToLabel(b.startMin)}</span> {b.clientName}
                        </span>
                      ))}
                    </span>
                    <span className="mo-load mt-auto" aria-hidden>
                      <span style={{ width: `${Math.max(6, occupancy(dayBookings, salon))}%` }} />
                    </span>
                  </>
                ) : loading ? (
                  <span className="skeleton mt-auto hidden h-1 md:block" aria-hidden />
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <aside className="w-full shrink-0 lg:sticky lg:top-3 lg:w-[340px]">
        <DayPanel
          salon={salon}
          date={date}
          today={today}
          nowMin={nowMin}
          bookings={bookingsByDate.get(date) ?? []}
          loading={loading}
          onOpenDay={() => onOpenDay(date)}
          onCreate={() => onCreateOn(date)}
          onSelectBooking={onSelectBooking}
        />
      </aside>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";

import { ChevronLeft, ChevronRight } from "@/components/icons";
import { addDays, addMonths, formatMonthYear, monthMatrix } from "@/lib/time";

type Props = {
  /** The picked date, or "" for none yet. */
  value: string;
  /** Today, for the "today" ring and (with `min`) what counts as past. */
  today: string;
  /** Earliest selectable date. Defaults to `today`: a booking cannot be made
   *  in the past. Pass an earlier value to browse history without picking it. */
  min?: string;
  onSelect: (date: string) => void;
};

const WEEKDAYS = ["lu", "ma", "me", "je", "ve", "sa", "di"];

/**
 * A month grid, one tap per day. The desktop half of the app's date field —
 * phones get the platform's own picker instead (see DateField in
 * booking-sheet.tsx), so this never has to also work as a touch wheel.
 */
export function Calendar({ value, today, min = today, onSelect }: Props) {
  const [month, setMonth] = useState(value || today);
  const cells = useMemo(() => monthMatrix(month), [month]);
  const { month: monthLabel, year } = useMemo(() => formatMonthYear(month), [month]);

  const move = (from: string, deltaDays: number) => {
    const next = addDays(from, deltaDays);
    if (next < min) return;
    if (next.slice(0, 7) !== month.slice(0, 7)) setMonth(next);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-cal-cell="${next}"]`)?.focus();
    });
  };

  return (
    <div className="cal">
      <div className="cal-head">
        <button
          type="button"
          className="btn-icon h-8 w-8"
          onClick={() => setMonth((m) => addMonths(m, -1))}
          aria-label="Mois précédent"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="cal-title first-letter:uppercase" data-nums>
          {monthLabel} {year}
        </span>
        <button
          type="button"
          className="btn-icon h-8 w-8"
          onClick={() => setMonth((m) => addMonths(m, 1))}
          aria-label="Mois suivant"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="cal-weekdays" aria-hidden>
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div role="grid" aria-label={`${monthLabel} ${year}`} className="cal-grid">
        {cells.map((cell) => {
          const disabled = cell.date < min;
          const selected = cell.date === value;
          return (
            <button
              key={cell.date}
              type="button"
              role="gridcell"
              data-cal-cell={cell.date}
              data-out={cell.inMonth ? undefined : ""}
              data-today={cell.date === today ? "" : undefined}
              aria-selected={selected}
              aria-disabled={disabled || undefined}
              tabIndex={selected || (!value && cell.date === today) ? 0 : -1}
              disabled={disabled}
              onClick={() => onSelect(cell.date)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  move(cell.date, 1);
                } else if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  move(cell.date, -1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  move(cell.date, 7);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  move(cell.date, -7);
                } else if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!disabled) onSelect(cell.date);
                }
              }}
              className="cal-cell"
              data-nums
            >
              {Number(cell.date.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

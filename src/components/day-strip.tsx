"use client";

import { useEffect, useRef } from "react";

import { addDays, todayInSalonTz } from "@/lib/time";

type Props = {
  date: string;
  today: string;
  onSelect: (date: string) => void;
};

const WEEKDAY = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  timeZone: "UTC",
});

function dayParts(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: WEEKDAY.format(dt).replace(".", ""),
    day: String(d),
  };
}

/**
 * Seven days you can reach with a thumb.
 *
 * Centred on the selected day rather than starting at the week's Monday: the
 * question staff ask is almost always "today, tomorrow, or the day after",
 * and a Monday-anchored week wastes half the strip on days already gone.
 */
export function DayStrip({ date, today, onSelect }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const selected = useRef<HTMLButtonElement>(null);

  const days = Array.from({ length: 7 }, (_, i) => addDays(date, i - 2));

  useEffect(() => {
    // Keep the selected cell in view when the date changes from elsewhere
    // (the arrows, the month calendar, a redirect).
    selected.current?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "smooth",
    });
  }, [date]);

  return (
    <div
      ref={scroller}
      className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0"
      role="group"
      aria-label="Choisir un jour"
    >
      {days.map((d) => {
        const { weekday, day } = dayParts(d);
        const isSelected = d === date;
        const isToday = d === today;

        return (
          <button
            key={d}
            ref={isSelected ? selected : null}
            type="button"
            onClick={() => onSelect(d)}
            aria-current={isSelected ? "date" : undefined}
            className="flex shrink-0 snap-center flex-col items-center justify-center gap-0.5 rounded-[8px] transition-colors duration-[120ms]"
            style={{
              width: 44,
              height: 56,
              background: isSelected ? "var(--brass)" : "transparent",
              color: isSelected ? "#fff" : "var(--ink-soft)",
            }}
          >
            <span className="t-micro" style={{ opacity: isSelected ? 0.85 : 1 }}>
              {weekday}
            </span>
            <span className="font-semibold" data-nums>
              {day}
            </span>
            {/* Today is a dot, not a ring, so "today" and "selected" can both
                be true without two devices fighting over the same cell. */}
            <span
              className="block h-[3px] w-[3px] rounded-full"
              style={{
                background: isToday
                  ? isSelected
                    ? "#fff"
                    : "var(--brass)"
                  : "transparent",
              }}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}

export { todayInSalonTz };

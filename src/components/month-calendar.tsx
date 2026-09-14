"use client";

import { useMemo } from "react";

import { ChevronLeft, ChevronRight } from "@/components/icons";
import { formatMonthYear, monthMatrix } from "@/lib/time";
import type { BookingDTO } from "@/lib/types";

type Props = {
  date: string;
  today: string;
  /** Active bookings for every day currently on screen, keyed by date. */
  bookingsByDate: Map<string, BookingDTO[]>;
  onSelectDate: (date: string) => void;
  onNavigateMonth: (deltaMonths: number) => void;
};

// 2023-01-01 was a Sunday in UTC — used only as a stable reference week to
// read weekday short-names off, never displayed itself.
const WEEKDAY_FMT = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  timeZone: "UTC",
});
const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, i) =>
  WEEKDAY_FMT.format(new Date(Date.UTC(2023, 0, 1 + i)))
    .replace(".", "")
    .toUpperCase(),
);

const MAX_TAGS = 2;

/**
 * The month, drawn as a grid of days rather than the single day-column this
 * app used before — the shape this screen was rebuilt around (see the note
 * at the top of docs/DESIGN.md). Each cell carries up to two tags naming the
 * day's bookings; status is still a surface, not a sticker: confirmed reads
 * in the accent, done recedes to a muted tone, cancelled is never fetched
 * here in the first place.
 */
export function MonthCalendar({
  date,
  today,
  bookingsByDate,
  onSelectDate,
  onNavigateMonth,
}: Props) {
  const cells = useMemo(() => monthMatrix(date), [date]);
  const { month, year } = useMemo(() => formatMonthYear(date), [date]);

  return (
    <section className="card p-4 md:p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="t-heading capitalize">{month}</span>
          <span className="t-heading" style={{ color: "var(--ink-soft)" }}>
            {year}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <MonthNavButton
            label="Mois précédent"
            onClick={() => onNavigateMonth(-1)}
          >
            <ChevronLeft size={15} />
          </MonthNavButton>
          <MonthNavButton
            label="Mois suivant"
            onClick={() => onNavigateMonth(1)}
          >
            <ChevronRight size={15} />
          </MonthNavButton>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-1.5 md:gap-2.5">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-center text-[11px] font-semibold tracking-[0.03em]"
            style={{ color: "var(--ink-faint)" }}
          >
            {label}
          </div>
        ))}
      </div>

      <div
        role="grid"
        aria-label={`Calendrier de ${month} ${year}`}
        className="grid grid-cols-7 gap-1.5 md:gap-2.5"
      >
        {cells.map((cell) => {
          const isToday = cell.date === today;
          const isSelected = cell.date === date;
          const isPast = !isToday && cell.date < today;
          const dayBookings = bookingsByDate.get(cell.date) ?? [];
          const tags = dayBookings.slice(0, MAX_TAGS);
          const overflow = dayBookings.length - tags.length;
          const dayNumber = Number(cell.date.slice(-2));

          return (
            <button
              key={cell.date}
              type="button"
              role="gridcell"
              onClick={() => onSelectDate(cell.date)}
              aria-current={isToday ? "date" : undefined}
              aria-label={`${dayNumber} ${month}${
                dayBookings.length > 0
                  ? `, ${dayBookings.length} rendez-vous`
                  : ""
              }${isPast ? ", passé" : ""}`}
              className="flex min-h-[64px] flex-col items-start gap-1 rounded-[12px] p-1.5 text-left transition-colors duration-[120ms] md:min-h-[84px] md:p-2"
              style={{
                background: isToday
                  ? "var(--accent)"
                  : isSelected
                    ? "var(--accent-tint)"
                    : "transparent",
                border:
                  isSelected && !isToday
                    ? "1.5px solid var(--accent)"
                    : "1.5px solid transparent",
                opacity: !cell.inMonth ? 0.3 : isPast ? 0.45 : 1,
              }}
            >
              <span
                className="text-[12.5px] font-semibold"
                style={{ color: isToday ? "#fff" : isPast ? "var(--ink-soft)" : "var(--ink)" }}
                data-nums
              >
                {dayNumber}
              </span>

              <span className="flex w-full flex-col gap-0.5">
                {tags.map((booking) => (
                  <DayTag key={booking.id} booking={booking} onDark={isToday} />
                ))}
                {overflow > 0 ? (
                  <span
                    className="text-[10.5px] font-medium"
                    style={{
                      color: isToday
                        ? "rgb(255 255 255 / 0.75)"
                        : "var(--ink-faint)",
                    }}
                  >
                    +{overflow}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DayTag({
  booking,
  onDark,
}: {
  booking: BookingDTO;
  onDark: boolean;
}) {
  const done = booking.status === "done";

  if (onDark) {
    return (
      <span
        className="truncate rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-semibold"
        style={{
          background: "rgb(255 255 255 / 0.18)",
          color: done ? "rgb(255 255 255 / 0.7)" : "#fff",
        }}
      >
        {booking.clientName}
      </span>
    );
  }

  return (
    <span
      className="truncate rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-semibold"
      style={{
        background: done ? "var(--surface-sunk)" : "var(--accent-tint)",
        color: done ? "var(--ink-faint)" : "var(--accent-hover)",
      }}
    >
      {booking.clientName}
    </span>
  );
}

function MonthNavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-[8px] transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
      style={{ color: "var(--ink-soft)" }}
    >
      {children}
    </button>
  );
}

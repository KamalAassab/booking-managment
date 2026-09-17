"use client";

import { useMemo } from "react";

import { describeBooking } from "@/components/booking-card";
import { ArrowUpRight, Check, Plus } from "@/components/icons";
import { bookingPhase, occupancy } from "@/lib/day-layout";
import { formatShortDate, minutesToLabel, weekDates } from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";

type Props = {
  salon: SalonDTO;
  date: string;
  today: string;
  nowMin: number;
  bookingsByDate: Map<string, BookingDTO[]>;
  /** Ids matching the search box, or null when nothing is searched. */
  matches: ((booking: BookingDTO) => boolean) | null;
  loading: boolean;
  onOpenDay: (date: string) => void;
  onCreateOn: (date: string) => void;
  onSelectBooking: (booking: BookingDTO) => void;
};

/** A column shows this many before handing over to the day view. */
const VISIBLE = 10;
/** On a phone the seven days are stacked, so each stays short. */
const VISIBLE_PHONE = 3;

const WEEKDAY_FMT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" });

function weekdayShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return WEEKDAY_FMT.format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * The week as seven day cards: how full each day is at a glance (count and
 * occupancy bar), and who is booked in time order. A card's head opens that
 * day's timeline; seven columns side by side on wide screens, stacked on a
 * phone. Time-proportional columns were tried before and could not show
 * services running at the same time in a 140px column.
 */
export function WeekGrid({
  salon,
  date,
  today,
  nowMin,
  bookingsByDate,
  matches,
  loading,
  onOpenDay,
  onCreateOn,
  onSelectBooking,
}: Props) {
  const days = useMemo(() => weekDates(date), [date]);

  const columns = useMemo(
    () =>
      days.map((d) => {
        const all = [...(bookingsByDate.get(d) ?? [])].sort(
          (a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id),
        );
        return {
          date: d,
          all,
          shown: matches ? all.filter(matches) : all,
          load: occupancy(all, salon),
        };
      }),
    [days, bookingsByDate, matches, salon],
  );

  const weekTotal = columns.reduce((sum, c) => sum + c.all.length, 0);

  return (
    <section aria-label="Semaine" className="flex flex-col gap-3">
      {!loading && weekTotal === 0 ? (
        <p className="t-small" style={{ color: "var(--ink-faint)" }}>
          Aucun rendez-vous cette semaine.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 xl:gap-2">
        {columns.map((col) => {
          const isToday = col.date === today;
          const isPast = col.date < today;
          const hidden = col.shown.length - VISIBLE;
          const count = col.all.length;
          return (
            <article
              key={col.date}
              className="wk-day"
              data-today={isToday ? "" : undefined}
              data-selected={col.date === date ? "" : undefined}
              data-past={isPast ? "" : undefined}
            >
              <button
                type="button"
                onClick={() => onOpenDay(col.date)}
                className="wk-head"
                aria-label={`Ouvrir ${formatShortDate(col.date)}, ${count} rendez-vous`}
              >
                <span className="flex w-full items-baseline gap-1.5">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.04em]" style={{ color: isToday ? "var(--accent-ink)" : "var(--ink-soft)" }}>
                    {weekdayShort(col.date)}
                  </span>
                  <span className="text-[20px] font-semibold leading-6" data-nums>
                    {Number(col.date.slice(8))}
                  </span>
                  <span className="ml-auto flex items-center gap-1 text-[12px] font-medium" style={{ color: "var(--ink-faint)" }}>
                    {loading && count === 0 ? "" : count === 0 ? "libre" : `${count} rdv`}
                    <ArrowUpRight size={14} />
                  </span>
                </span>
                <span className="wk-load" aria-hidden>
                  <span style={{ width: `${col.load}%` }} />
                </span>
              </button>

              {loading && count === 0 ? (
                <div className="flex flex-col gap-1.5 p-2">
                  <div className="skeleton h-[46px]" />
                  <div className="skeleton h-[46px]" />
                </div>
              ) : col.shown.length > 0 ? (
                <ol className="flex flex-col gap-1.5 p-2">
                  {col.shown.slice(0, VISIBLE).map((b, index) => {
                    const phase = bookingPhase(b, today, nowMin);
                    return (
                      <li key={b.id} className={index >= VISIBLE_PHONE ? "hidden md:block" : undefined}>
                        <button
                          type="button"
                          onClick={() => onSelectBooking(b)}
                          className="bk w-full py-1.5"
                          data-phase={phase}
                          aria-label={describeBooking(b, phase)}
                          title={describeBooking(b, phase)}
                        >
                          <span className="bk-name text-[13px]">
                            <span className="shrink-0" data-nums style={{ color: "var(--ink-soft)" }}>
                              {minutesToLabel(b.startMin)}
                            </span>
                            {phase === "done" ? (
                              <span className="shrink-0" style={{ color: "var(--success)" }}>
                                <Check size={13} />
                              </span>
                            ) : null}
                            <span className="truncate">{b.clientName}</span>
                          </span>
                          <span className="bk-line flex items-center gap-2 text-[12px]">
                            <span className="truncate">{b.serviceLabel}</span>
                            {/* Dropped only at xl, where the week becomes
                                seven narrow columns and the name needs the
                                room more than the clock does. */}
                            <span
                              className="ml-auto shrink-0 xl:hidden"
                              style={{ color: "var(--ink-faint)" }}
                            >
                              fin <span data-nums>{minutesToLabel(b.startMin + b.durationMin)}</span>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : matches && count > 0 ? (
                <p className="t-small px-3 py-3" style={{ color: "var(--ink-faint)" }}>
                  Aucun résultat
                </p>
              ) : null}

              <div className="mt-auto flex flex-col gap-1 px-2 pb-2">
                {col.shown.length > VISIBLE_PHONE ? (
                  <button type="button" onClick={() => onOpenDay(col.date)} className="wk-more md:hidden">
                    Voir les {col.shown.length - VISIBLE_PHONE} autres
                  </button>
                ) : null}
                {hidden > 0 ? (
                  <button type="button" onClick={() => onOpenDay(col.date)} className="wk-more hidden md:inline-flex">
                    Voir les {hidden} autres
                  </button>
                ) : null}
                {!isPast ? (
                  <button
                    type="button"
                    onClick={() => onCreateOn(col.date)}
                    className="wk-more"
                    aria-label={`Nouveau rendez-vous le ${formatShortDate(col.date)}`}
                  >
                    <Plus size={15} />
                    Réserver
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

"use client";

import { useMemo } from "react";

import { Check, Plus } from "@/components/icons";
import { formatPhoneForDisplay } from "@/lib/phone";
import { minutesToLabel, nowMinutesInSalonTz, slotsForSalon } from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";

type Props = {
  salon: SalonDTO;
  date: string;
  today: string;
  bookings: BookingDTO[];
  onSelectSlot: (startMin: number) => void;
  onSelectBooking: (booking: BookingDTO) => void;
};

/** Height of one slot row. The unit the whole grid is measured in. */
const ROW_PX = 56;
/** Width of the time rail. Fits "09:00" at 13px with room to breathe. */
const RAIL_PX = 56;

/**
 * The day, drawn as a column that fills up.
 *
 * Bookings are placed by CSS Grid row arithmetic rather than absolute
 * positioning, so height is proportional to duration by construction: a
 * 90-minute coloration occupies exactly three times the rows of a 30-minute
 * cut. The shape of the day is legible before a single word is read, which
 * is the entire job of this screen.
 *
 * Status is carried by surface treatment, never by a badge — see
 * docs/DESIGN.md §1. Cancelled bookings are not drawn at all, because the
 * slot genuinely is free again; that is the same rule the database's
 * exclusion constraint applies.
 */
export function DayGrid({
  salon,
  date,
  today,
  bookings,
  onSelectSlot,
  onSelectBooking,
}: Props) {
  const slots = useMemo(() => slotsForSalon(salon), [salon]);

  const active = useMemo(
    () => bookings.filter((b) => b.status !== "cancelled"),
    [bookings],
  );

  const byStart = useMemo(() => {
    const map = new Map<number, BookingDTO>();
    for (const b of active) map.set(b.startMin, b);
    return map;
  }, [active]);

  /** Slots swallowed by a longer booking that started earlier. */
  const covered = useMemo(() => {
    const set = new Set<number>();
    for (const b of active) {
      for (
        let t = b.startMin + salon.slotMin;
        t < b.startMin + b.durationMin;
        t += salon.slotMin
      ) {
        set.add(t);
      }
    }
    return set;
  }, [active, salon.slotMin]);

  const nowMin = date === today ? nowMinutesInSalonTz() : null;

  // Fractional row offset of the live edge, so the rule sits at the true
  // minute rather than snapping to the nearest half hour.
  const nowOffset =
    nowMin !== null && nowMin >= salon.opensAtMin && nowMin < salon.closesAtMin
      ? ((nowMin - salon.opensAtMin) / salon.slotMin) * ROW_PX
      : null;

  if (slots.length === 0) {
    return (
      <p className="card p-5 text-[color:var(--ink-soft)]">
        Les horaires de ce salon ne définissent aucun créneau.
      </p>
    );
  }

  return (
    <div
      className="card relative overflow-hidden"
      role="grid"
      aria-label={`Créneaux du ${date}`}
    >
      <div
        className="relative grid"
        style={{
          gridTemplateColumns: `${RAIL_PX}px 1fr`,
          gridAutoRows: `${ROW_PX}px`,
        }}
      >
        {/* Rail and row lines. Drawn first so cards sit above them. */}
        {slots.map((startMin, i) => {
          const isPast = nowMin !== null && startMin + salon.slotMin <= nowMin;
          return (
            <div key={`r-${startMin}`} className="contents">
              <div
                className="t-small flex items-start justify-end pr-3 pt-2"
                style={{
                  gridColumn: 1,
                  gridRow: i + 1,
                  color: "var(--ink-faint)",
                  borderTop: i === 0 ? "none" : "1px solid var(--line)",
                  opacity: isPast ? 0.55 : 1,
                }}
              >
                <time dateTime={`${date}T${minutesToLabel(startMin)}`}>
                  {minutesToLabel(startMin)}
                </time>
              </div>
              <div
                style={{
                  gridColumn: 2,
                  gridRow: i + 1,
                  borderTop: i === 0 ? "none" : "1px solid var(--line)",
                  borderLeft: "1px solid var(--line)",
                  background: isPast ? "var(--surface-sunk)" : "transparent",
                }}
              />
            </div>
          );
        })}

        {/* Free slots and bookings, above the rules. */}
        {slots.map((startMin, i) => {
          const booking = byStart.get(startMin);
          if (covered.has(startMin)) return null;

          if (booking) {
            return (
              <BookingCard
                key={booking.id}
                booking={booking}
                row={i + 1}
                span={Math.max(
                  1,
                  Math.ceil(booking.durationMin / salon.slotMin),
                )}
                onSelect={() => onSelectBooking(booking)}
              />
            );
          }

          return (
            <FreeSlot
              key={`f-${startMin}`}
              row={i + 1}
              label={minutesToLabel(startMin)}
              isPast={nowMin !== null && startMin + salon.slotMin <= nowMin}
              onSelect={() => onSelectSlot(startMin)}
            />
          );
        })}

        {/* The live edge of the day. One of the two places brass appears. */}
        {nowOffset !== null ? (
          <div
            className="pointer-events-none absolute right-0 flex items-center"
            style={{ top: nowOffset, left: RAIL_PX - 4 }}
            aria-hidden
          >
            <span
              className="block h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--brass)" }}
            />
            <span
              className="block h-px flex-1"
              style={{ background: "var(--brass)", opacity: 0.45 }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FreeSlot({
  row,
  label,
  isPast,
  onSelect,
}: {
  row: number;
  label: string;
  isPast: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      // A real button, not a decorated div: keyboard-reachable and it
      // announces itself.
      className="group relative m-1 flex items-center gap-1.5 rounded-[10px] px-2.5 text-left transition-colors duration-[120ms] hover:bg-[color:var(--brass-tint)] focus-visible:bg-[color:var(--brass-tint)]"
      style={{ gridColumn: 2, gridRow: row, opacity: isPast ? 0.55 : 1 }}
      // Past slots stay clickable: entering a booking someone forgot at 6pm
      // is a real thing a front desk does.
      aria-label={`Réserver le créneau de ${label}`}
    >
      <span
        className="slot-mark transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ color: "var(--brass)" }}
      >
        <Plus size={16} />
      </span>
      <span
        className="t-small opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ color: "var(--brass)" }}
      >
        Réserver
      </span>
    </button>
  );
}

function BookingCard({
  booking,
  row,
  span,
  onSelect,
}: {
  booking: BookingDTO;
  row: number;
  span: number;
  onSelect: () => void;
}) {
  const done = booking.status === "done";

  return (
    <button
      type="button"
      onClick={onSelect}
      className="relative m-1 flex flex-col items-start overflow-hidden rounded-[10px] px-3 py-2 text-left transition-[background-color,border-color] duration-[120ms]"
      style={{
        gridColumn: 2,
        gridRow: `${row} / span ${span}`,
        background: done ? "var(--surface-sunk)" : "var(--surface)",
        border: `1px solid var(--line)`,
        // The leading rule is the confirmed state's whole signal. A finished
        // booking loses it, so the day visibly recedes behind you.
        borderLeft: done
          ? "1px solid var(--line)"
          : "3px solid var(--brass)",
        paddingLeft: done ? 12 : 10,
      }}
    >
      <span className="flex w-full items-center gap-1.5">
        {done ? (
          <span className="shrink-0" style={{ color: "var(--ink-faint)" }}>
            <Check size={14} />
          </span>
        ) : null}
        <span
          className="truncate font-semibold"
          style={{ color: done ? "var(--ink-soft)" : "var(--ink)" }}
        >
          {booking.clientName}
        </span>

        {/* A single-slot card is 56px tall and cannot hold four stacked
            lines: the service used to be clipped mid-word. At this height
            the service rides on the name's line instead, and the details
            that do not fit are in the sheet a tap away. */}
        {span === 1 ? (
          <span
            className="t-small min-w-0 flex-1 truncate"
            style={{ color: "var(--ink-faint)" }}
          >
            · {booking.service}
          </span>
        ) : null}

        <span
          className="t-small ml-auto shrink-0 pl-1"
          style={{ color: "var(--ink-faint)" }}
          data-nums
        >
          {booking.durationMin} min
        </span>
      </span>

      {span > 1 ? (
        <span
          className="t-small w-full truncate"
          style={{ color: "var(--ink-soft)" }}
        >
          {booking.service}
        </span>
      ) : null}

      {span > 1 ? (
        <span
          className="t-small w-full truncate"
          style={{ color: "var(--ink-faint)" }}
          data-nums
        >
          {formatPhoneForDisplay(booking.clientPhone)}
        </span>
      ) : null}

      {booking.notes && span > 2 ? (
        <span
          className="t-small mt-1 line-clamp-2 w-full"
          style={{ color: "var(--ink-faint)" }}
        >
          {booking.notes}
        </span>
      ) : null}

      {/* Status is visual; screen readers get it in words. */}
      <span className="sr-only">{done ? "Terminé" : "Confirmé"}</span>
    </button>
  );
}

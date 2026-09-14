"use client";

import { useMemo } from "react";

import { Check, Phone, Plus, User, WhatsApp } from "@/components/icons";
import { formatPhoneForDisplay } from "@/lib/phone";
import { minutesToLabel, nowMinutesInSalonTz, slotsForSalon } from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";
import { buildWhatsAppLink } from "@/lib/whatsapp";

type Props = {
  salon: SalonDTO;
  date: string;
  today: string;
  bookings: BookingDTO[];
  onSelectSlot: (startMin: number) => void;
  onSelectBooking: (booking: BookingDTO) => void;
};

/** Height of one slot row. The unit the whole grid is measured in. */
const ROW_PX = 60;
/** Width of the time rail. Fits "09:00" at 13px with room to breathe. */
const RAIL_PX = 56;

/**
 * The day view — the default. A salon day is a column that fills up exactly
 * between opening and closing: height is proportional to duration by
 * construction, so a 90-minute colouration is three times the height of a
 * 30-minute cut and the shape of the day reads before a single word does.
 *
 * Status is carried by surface treatment, never a badge. Cancelled bookings
 * are not drawn at all — the slot genuinely is free again.
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

  const isFullyPast = date < today;
  const nowMin = date === today ? nowMinutesInSalonTz() : null;

  const nowOffset =
    nowMin !== null && nowMin >= salon.opensAtMin && nowMin < salon.closesAtMin
      ? ((nowMin - salon.opensAtMin) / salon.slotMin) * ROW_PX
      : null;

  if (slots.length === 0) {
    return (
      <p className="card p-5" style={{ color: "var(--ink-soft)" }}>
        Les horaires de ce salon ne définissent aucun créneau.
      </p>
    );
  }

  return (
    <div
      className="card relative overflow-hidden p-2"
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
        {slots.map((startMin, i) => {
          const isPast = isFullyPast || (nowMin !== null && startMin + salon.slotMin <= nowMin);
          const onHour = startMin % 60 === 0;
          return (
            <div key={`r-${startMin}`} className="contents">
              <div
                className="flex items-start justify-end pr-3 pt-2.5"
                style={{
                  gridColumn: 1,
                  gridRow: i + 1,
                  color: onHour ? "var(--ink-soft)" : "var(--ink-faint)",
                  fontSize: onHour ? 13 : 11.5,
                  fontWeight: onHour ? 600 : 400,
                  borderTop: i === 0 ? "none" : `1px solid var(--line)`,
                  opacity: isPast ? 0.5 : 1,
                }}
                data-nums
              >
                <time dateTime={`${date}T${minutesToLabel(startMin)}`}>
                  {minutesToLabel(startMin)}
                </time>
              </div>
              <div
                className="rounded-r-[10px]"
                style={{
                  gridColumn: 2,
                  gridRow: i + 1,
                  borderTop: i === 0 ? "none" : "1px solid var(--line)",
                  background: onHour
                    ? "color-mix(in srgb, var(--surface-sunk) 55%, transparent)"
                    : "transparent",
                  opacity: isPast ? 0.6 : 1,
                }}
              />
            </div>
          );
        })}

        {slots.map((startMin, i) => {
          const booking = byStart.get(startMin);
          if (covered.has(startMin)) return null;

          if (booking) {
            return (
              <BookingCard
                key={booking.id}
                booking={booking}
                salon={salon}
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
              isPast={isFullyPast || (nowMin !== null && startMin + salon.slotMin <= nowMin)}
              onSelect={() => onSelectSlot(startMin)}
            />
          );
        })}

        {/* The live edge of the day — the one place the accent marks time
            rather than a status. */}
        {nowOffset !== null ? (
          <div
            className="pointer-events-none absolute right-0 z-10 flex items-center"
            style={{ top: nowOffset, left: RAIL_PX - 5 }}
            aria-hidden
          >
            <span
              className="block h-2.5 w-2.5 rounded-full"
              style={{
                background: "var(--accent)",
                boxShadow: "0 0 0 4px var(--accent-tint)",
              }}
            />
            <span
              className="block h-[2px] flex-1"
              style={{ background: "var(--accent)", opacity: 0.55 }}
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
      onClick={isPast ? undefined : onSelect}
      disabled={isPast}
      className="group relative m-1 flex items-center gap-1.5 rounded-[10px] border border-dashed px-3 text-left transition-colors duration-[120ms] hover:border-solid hover:bg-[color:var(--accent-tint)] disabled:cursor-default disabled:hover:border-dashed disabled:hover:bg-transparent"
      style={{
        gridColumn: 2,
        gridRow: row,
        opacity: isPast ? 0.35 : 1,
        borderColor: "var(--line)",
      }}
      aria-label={`Réserver le créneau de ${label}`}
    >
      <span
        className="flex items-center transition-[color,opacity] duration-[120ms] group-hover:opacity-100"
        style={{ color: "var(--ink-faint)", opacity: 0.6 }}
      >
        <Plus size={15} />
      </span>
      <span
        className="t-small opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100"
        style={{ color: "var(--accent-hover)", fontWeight: 600 }}
      >
        Réserver
      </span>
    </button>
  );
}

function BookingCard({
  booking,
  salon,
  row,
  span,
  onSelect,
}: {
  booking: BookingDTO;
  salon: SalonDTO;
  row: number;
  span: number;
  onSelect: () => void;
}) {
  const done = booking.status === "done";
  const whatsapp =
    !done && span > 1
      ? buildWhatsAppLink({
          clientName: booking.clientName,
          clientPhone: booking.clientPhone,
          salonName: salon.name,
          bookingDate: booking.bookingDate,
          startMin: booking.startMin,
          service: booking.service,
        })
      : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="relative m-1 flex flex-col items-start overflow-hidden rounded-[12px] px-3.5 py-2.5 text-left shadow-sm transition-[background-color,border-color,box-shadow] duration-[120ms] hover:brightness-110"
      style={{
        gridColumn: 2,
        gridRow: `${row} / span ${span}`,
        background: done ? "var(--surface-sunk)" : "var(--accent-tint)",
        border: `1px solid ${done ? "var(--line)" : "color-mix(in srgb, var(--accent) 35%, transparent)"}`,
        borderLeft: done ? "1px solid var(--line)" : "4px solid var(--accent)",
        paddingLeft: done ? 14 : 12,
      }}
    >
      <span className="flex w-full items-center gap-1.5">
        {done ? (
          <span className="shrink-0" style={{ color: "var(--ink-faint)" }}>
            <Check size={14} />
          </span>
        ) : (
          <span
            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--surface)", color: "var(--accent-hover)" }}
            aria-hidden
          >
            {booking.channel === "call_center" ? (
              <Phone size={10} />
            ) : (
              <User size={10} />
            )}
          </span>
        )}
        <span
          className="truncate font-semibold"
          style={{ color: done ? "var(--ink-soft)" : "var(--ink)" }}
        >
          {booking.clientName}
        </span>

        {span === 1 ? (
          <span
            className="t-small min-w-0 flex-1 truncate"
            style={{ color: done ? "var(--ink-faint)" : "var(--ink-soft)" }}
          >
            · {booking.service}
          </span>
        ) : null}

        <span
          className="t-small ml-auto shrink-0 rounded-full px-2 py-0.5"
          style={{
            color: done ? "var(--ink-faint)" : "var(--accent-hover)",
            background: done ? "transparent" : "var(--surface)",
          }}
          data-nums
        >
          {booking.durationMin} min
        </span>
      </span>

      {span > 1 ? (
        <span
          className="t-small mt-0.5 w-full truncate"
          style={{ color: done ? "var(--ink-faint)" : "var(--ink-soft)" }}
        >
          {booking.service}
        </span>
      ) : null}

      {span > 1 ? (
        <span
          className="mt-auto flex w-full items-center gap-2 pt-1.5"
          data-nums
        >
          <span className="t-small truncate" style={{ color: "var(--ink-faint)" }}>
            {formatPhoneForDisplay(booking.clientPhone)}
          </span>
          {whatsapp ? (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold"
              style={{ background: "var(--surface)", color: "var(--accent-hover)" }}
            >
              <WhatsApp size={10} />
              WhatsApp
            </a>
          ) : null}
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

      <span className="sr-only">{done ? "Terminé" : "Confirmé"}</span>
    </button>
  );
}

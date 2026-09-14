"use client";

import { useMemo } from "react";

import { Check, Clock, Moon, Phone, Plus, Sun, User, WhatsApp } from "@/components/icons";
import { formatPhoneForDisplay } from "@/lib/phone";
import { getServicesForSalon } from "@/lib/services-catalog";
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

  const isFullyPast = date < today;
  const nowMin = date === today ? nowMinutesInSalonTz() : null;

  // Split slots into 2 natural periods: Morning & Afternoon/Evening
  const midpoint = Math.ceil(slots.length / 2);
  const table1Slots = useMemo(() => slots.slice(0, midpoint), [slots, midpoint]);
  const table2Slots = useMemo(() => slots.slice(midpoint), [slots, midpoint]);

  if (slots.length === 0) {
    return (
      <p className="card p-5" style={{ color: "var(--ink-soft)" }}>
        Les horaires de ce salon ne définissent aucun créneau.
      </p>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      {/* Period 1: Morning / Early Afternoon */}
      {table1Slots.length > 0 && (
        <DayPeriodSection
          title="Matinée & Début d'après-midi"
          icon={<Sun size={17} className="text-amber-500" />}
          periodSlots={table1Slots}
          salon={salon}
          date={date}
          isFullyPast={isFullyPast}
          nowMin={nowMin}
          activeBookings={active}
          onSelectSlot={onSelectSlot}
          onSelectBooking={onSelectBooking}
        />
      )}

      {/* Period 2: Afternoon & Evening */}
      {table2Slots.length > 0 && (
        <DayPeriodSection
          title="Après-midi & Soirée"
          icon={<Moon size={17} className="text-indigo-400" />}
          periodSlots={table2Slots}
          salon={salon}
          date={date}
          isFullyPast={isFullyPast}
          nowMin={nowMin}
          activeBookings={active}
          onSelectSlot={onSelectSlot}
          onSelectBooking={onSelectBooking}
        />
      )}
    </div>
  );
}

function DayPeriodSection({
  title,
  icon,
  periodSlots,
  salon,
  date,
  isFullyPast,
  nowMin,
  activeBookings,
  onSelectSlot,
  onSelectBooking,
}: {
  title: string;
  icon: React.ReactNode;
  periodSlots: number[];
  salon: SalonDTO;
  date: string;
  isFullyPast: boolean;
  nowMin: number | null;
  activeBookings: BookingDTO[];
  onSelectSlot: (startMin: number) => void;
  onSelectBooking: (booking: BookingDTO) => void;
}) {
  const periodStartMin = periodSlots[0];
  const periodEndMin = periodSlots[periodSlots.length - 1] + salon.slotMin;
  const timeRangeLabel = `${minutesToLabel(periodStartMin)} — ${minutesToLabel(periodEndMin)}`;

  // Filter bookings falling in this period
  const periodBookings = useMemo(
    () =>
      activeBookings
        .filter((b) => b.startMin < periodEndMin && b.startMin + b.durationMin > periodStartMin)
        .sort((a, b) => a.startMin - b.startMin || b.durationMin - a.durationMin),
    [activeBookings, periodStartMin, periodEndMin],
  );

  // Group bookings by start time to detect concurrent appointments
  const bookingsByStart = useMemo(() => {
    const map = new Map<number, BookingDTO[]>();
    for (const b of periodBookings) {
      const arr = map.get(b.startMin) ?? [];
      arr.push(b);
      map.set(b.startMin, arr);
    }
    return map;
  }, [periodBookings]);

  // Set of occupied start times
  const occupiedSlots = useMemo(() => {
    const set = new Set<number>();
    for (const b of periodBookings) {
      for (let t = b.startMin; t < b.startMin + b.durationMin; t += salon.slotMin) {
        set.add(t);
      }
    }
    return set;
  }, [periodBookings, salon.slotMin]);

  // Count max simultaneous bookings at any moment in this period
  const maxConcurrent = useMemo(() => {
    let max = 0;
    for (const slot of periodSlots) {
      let count = 0;
      for (const b of periodBookings) {
        if (b.startMin <= slot && b.startMin + b.durationMin > slot) {
          count++;
        }
      }
      max = Math.max(max, count);
    }
    return max;
  }, [periodSlots, periodBookings]);

  /** Fractional position of "now" in this period section */
  const nowFraction =
    nowMin !== null && nowMin >= periodStartMin && nowMin < periodEndMin
      ? (nowMin - periodStartMin) / (periodEndMin - periodStartMin)
      : null;

  return (
    <div
      className="card relative flex w-full flex-col overflow-hidden p-3.5 md:p-5"
      role="region"
      aria-label={`${title} (${timeRangeLabel})`}
    >
      {/* Period Header */}
      <div
        className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b pb-3"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{ background: "var(--surface-sunk)" }}
          >
            {icon}
          </span>
          <span className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
            {title}
          </span>
          <span
            className="t-small rounded-md px-2 py-0.5 text-[11px] font-medium"
            style={{ color: "var(--ink-soft)", background: "var(--surface-sunk)" }}
            data-nums
          >
            {timeRangeLabel}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {periodBookings.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <span
                className="t-small rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
                style={{
                  background: "var(--accent-tint)",
                  color: "var(--accent-hover)",
                  border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
                }}
              >
                {periodBookings.length} {periodBookings.length > 1 ? "rendez-vous" : "rendez-vous"}
              </span>
              {maxConcurrent > 1 && (
                <span
                  className="t-small rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ background: "var(--surface-sunk)", color: "var(--ink-soft)" }}
                >
                  ⚡ {maxConcurrent} simultanés
                </span>
              )}
            </div>
          ) : (
            <span className="t-small text-[12px]" style={{ color: "var(--ink-faint)" }}>
              Aucun rendez-vous sur cette période
            </span>
          )}
        </div>
      </div>

      {/* Interactive Time Ribbon (All 30m slots) */}
      <div className="mb-4 flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[11px] font-medium" style={{ color: "var(--ink-faint)" }}>
          <span>Frise temporelle des créneaux</span>
          <span>Cliquer sur un créneau libre pour réserver</span>
        </div>

        <div className="relative overflow-x-auto no-scrollbar rounded-[12px] p-1.5" style={{ background: "var(--surface-sunk)" }}>
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: `repeat(${periodSlots.length}, minmax(58px, 1fr))`,
            }}
          >
            {periodSlots.map((startMin) => {
              const isPast = isFullyPast || (nowMin !== null && startMin + salon.slotMin <= nowMin);
              const hasBookings = periodBookings.filter(
                (b) => b.startMin <= startMin && b.startMin + b.durationMin > startMin,
              );
              const isOccupied = hasBookings.length > 0;
              const isMulti = hasBookings.length > 1;
              const onHour = startMin % 60 === 0;

              if (isOccupied) {
                return (
                  <button
                    key={`ribbon-${startMin}`}
                    type="button"
                    onClick={() => onSelectBooking(hasBookings[0])}
                    className="group relative flex flex-col items-center justify-center rounded-[8px] py-1.5 px-1 transition-all duration-[120ms] hover:scale-[1.02]"
                    style={{
                      background: hasBookings[0].status === "done" ? "var(--surface)" : "var(--accent)",
                      color: hasBookings[0].status === "done" ? "var(--ink-soft)" : "#FFFFFF",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                    }}
                    title={`${minutesToLabel(startMin)}: ${hasBookings.map((b) => `${b.clientName} (${b.service})`).join(" + ")}`}
                  >
                    <span className="text-[11px] font-bold" data-nums>
                      {minutesToLabel(startMin)}
                    </span>
                    <span
                      className="mt-0.5 truncate text-[9.5px] font-semibold opacity-90 max-w-full"
                    >
                      {isMulti ? `⚡ ${hasBookings.length}` : hasBookings[0].clientName.split(" ")[0]}
                    </span>
                  </button>
                );
              }

              return (
                <button
                  key={`ribbon-${startMin}`}
                  type="button"
                  disabled={isPast}
                  onClick={isPast ? undefined : () => onSelectSlot(startMin)}
                  className="group flex flex-col items-center justify-center rounded-[8px] py-1.5 px-1 transition-colors duration-[120ms] hover:bg-[color:var(--surface)] hover:text-[color:var(--accent-hover)] disabled:cursor-default disabled:opacity-40"
                  style={{
                    background: "transparent",
                    color: onHour ? "var(--ink)" : "var(--ink-soft)",
                  }}
                  aria-label={`Réserver à ${minutesToLabel(startMin)}`}
                >
                  <span className="text-[11px] font-semibold" data-nums>
                    {minutesToLabel(startMin)}
                  </span>
                  <span
                    className="mt-0.5 flex items-center text-[9px] font-medium opacity-60 group-hover:opacity-100"
                    style={{ color: "var(--accent-hover)" }}
                  >
                    <Plus size={10} className="mr-0.5" /> Libre
                  </span>
                </button>
              );
            })}
          </div>

          {/* Current time bar on ribbon */}
          {nowFraction !== null && (
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-10 flex flex-col items-center"
              style={{ left: `${nowFraction * 100}%` }}
              aria-hidden
            >
              <span
                className="block h-2 w-2 rounded-full"
                style={{
                  background: "var(--accent)",
                  boxShadow: "0 0 0 3px var(--surface)",
                }}
              />
              <span className="block w-[2px] flex-1" style={{ background: "var(--accent)" }} />
            </div>
          )}
        </div>
      </div>

      {/* Main Appointment Board / Active Sessions */}
      {periodBookings.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 pt-1 text-[12px] font-semibold" style={{ color: "var(--ink-soft)" }}>
            <Clock size={14} className="text-[color:var(--accent-hover)]" />
            <span>Rendez-vous programmés</span>
          </div>

          {/* Render grouped by time slots with multi-card support */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {periodBookings.map((booking, idx) => {
              const startLabel = minutesToLabel(booking.startMin);
              const endLabel = minutesToLabel(booking.startMin + booking.durationMin);
              const isParallel =
                periodBookings.some(
                  (other) =>
                    other.id !== booking.id &&
                    other.startMin < booking.startMin + booking.durationMin &&
                    other.startMin + other.durationMin > booking.startMin,
                );

              return (
                <AppointmentDetailedCard
                  key={booking.id}
                  booking={booking}
                  salon={salon}
                  startLabel={startLabel}
                  endLabel={endLabel}
                  isParallel={isParallel}
                  onSelect={() => onSelectBooking(booking)}
                />
              );
            })}
          </div>
        </div>
      ) : (
        /* Empty state for period: show 1-click slot picker */
        <div
          className="flex flex-col items-center justify-center rounded-[12px] border border-dashed py-8 px-4 text-center"
          style={{ borderColor: "var(--line)" }}
        >
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full mb-2"
            style={{ background: "var(--surface-sunk)", color: "var(--ink-faint)" }}
          >
            <Clock size={20} />
          </div>
          <p className="text-[13.5px] font-medium" style={{ color: "var(--ink)" }}>
            Tous les créneaux sont disponibles
          </p>
          <p className="t-small mt-0.5 mb-4 text-[12px]" style={{ color: "var(--ink-faint)" }}>
            Touchez un créneau ci-dessus ou choisissez une heure rapide pour enregistrer un client.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {periodSlots.slice(0, 6).map((startMin) => (
              <button
                key={`quick-${startMin}`}
                type="button"
                onClick={() => onSelectSlot(startMin)}
                className="btn-secondary btn-sm flex items-center gap-1 text-[12px]"
              >
                <Plus size={13} /> {minutesToLabel(startMin)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AppointmentDetailedCard({
  booking,
  salon,
  startLabel,
  endLabel,
  isParallel,
  onSelect,
}: {
  booking: BookingDTO;
  salon: SalonDTO;
  startLabel: string;
  endLabel: string;
  isParallel: boolean;
  onSelect: () => void;
}) {
  const done = booking.status === "done";
  const catalogEntry = getServicesForSalon(salon.slug).find(
    (s) => s.name.toLowerCase() === booking.service.toLowerCase(),
  );
  const price = catalogEntry?.price;
  const whatsapp =
    !done && booking.clientPhone
      ? buildWhatsAppLink({
          clientName: booking.clientName,
          clientPhone: booking.clientPhone,
          salonName: salon.name,
          salonSlug: salon.slug,
          bookingDate: booking.bookingDate,
          startMin: booking.startMin,
          durationMin: booking.durationMin,
          service: booking.service,
          notes: booking.notes,
        })
      : null;

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="group relative flex flex-col justify-between overflow-hidden rounded-[14px] p-3.5 text-left transition-all duration-[120ms] hover:shadow-md hover:brightness-[1.02] cursor-pointer"
      style={{
        background: done ? "var(--surface-sunk)" : "var(--surface)",
        border: `1px solid ${done ? "var(--line)" : "color-mix(in srgb, var(--accent) 38%, transparent)"}`,
        borderLeft: done ? "4px solid var(--line-strong)" : "4.5px solid var(--accent)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
      }}
    >
      {/* Top row: Time window & Parallel badge & Duration */}
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-bold tracking-tight"
            style={{
              background: done ? "var(--surface)" : "var(--accent-tint)",
              color: done ? "var(--ink-soft)" : "var(--accent-hover)",
            }}
            data-nums
          >
            <Clock size={11} /> {startLabel} — {endLabel}
          </span>
          <span
            className="t-small rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold"
            style={{
              background: "var(--surface-sunk)",
              color: "var(--ink-soft)",
            }}
            data-nums
          >
            {booking.durationMin} min
          </span>
        </div>

        {isParallel && (
          <span
            className="t-small inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{
              background: "color-mix(in srgb, var(--accent) 15%, transparent)",
              color: "var(--accent-hover)",
            }}
          >
            ⚡ Simultané
          </span>
        )}
      </div>

      {/* Middle row: Client Name & Service */}
      <div className="my-1.5 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
            style={{
              background: done ? "var(--line)" : "var(--accent-tint)",
              color: done ? "var(--ink-faint)" : "var(--accent-hover)",
            }}
            aria-hidden
          >
            {booking.channel === "call_center" ? <Phone size={10} /> : <User size={10} />}
          </span>
          <span
            className="truncate text-[14px] font-bold leading-tight"
            style={{ color: done ? "var(--ink-soft)" : "var(--ink)" }}
          >
            {booking.clientName}
          </span>
          {done && (
            <span
              className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
              style={{ background: "var(--line)", color: "var(--ink-faint)" }}
            >
              <Check size={11} /> Terminé
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <span
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-semibold"
            style={{
              background: done ? "transparent" : "var(--accent-tint)",
              color: done ? "var(--ink-soft)" : "var(--accent-hover)",
              border: `1px solid ${done ? "var(--line)" : "color-mix(in srgb, var(--accent) 25%, transparent)"}`,
            }}
          >
            {booking.service}
          </span>

          {price !== undefined && (
            <span
              className="t-small text-[11.5px] font-bold"
              style={{ color: "var(--ink)" }}
              data-nums
            >
              {price} MAD
            </span>
          )}
        </div>

        {booking.notes && (
          <p
            className="t-small mt-1 line-clamp-2 text-[11px] italic"
            style={{ color: "var(--ink-faint)" }}
          >
            « {booking.notes} »
          </p>
        )}
      </div>

      {/* Bottom row: Phone Number & Direct WhatsApp */}
      <div
        className="mt-2.5 flex items-center justify-between gap-2 border-t pt-2"
        style={{ borderColor: "var(--line)" }}
        data-nums
      >
        <span className="text-[11.5px] font-medium" style={{ color: "var(--ink-soft)" }}>
          {formatPhoneForDisplay(booking.clientPhone)}
        </span>

        {whatsapp ? (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold transition-transform hover:scale-105"
            style={{
              background: "#25D366",
              color: "#FFFFFF",
              boxShadow: "0 1px 3px rgba(37, 211, 102, 0.25)",
            }}
          >
            <WhatsApp size={11} />
            WhatsApp
          </a>
        ) : null}
      </div>
    </div>
  );
}

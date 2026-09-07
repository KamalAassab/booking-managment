/**
 * All salon times are handled as "minutes from midnight, salon-local" plus a
 * plain YYYY-MM-DD date string. Nothing in the booking path constructs a
 * `Date` from user input, so a server running in UTC and a browser running in
 * Africa/Casablanca can never disagree about which day a booking is on.
 */

export const SALON_TIME_ZONE = "Africa/Casablanca";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date in the salons' own timezone, as YYYY-MM-DD. */
export function todayInSalonTz(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SALON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Current time of day in the salons' timezone, as minutes from midnight. */
export function nowMinutesInSalonTz(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SALON_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const [h, m] = parts.split(":").map(Number);
  return h * 60 + m;
}

export function isValidDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Round-trip through UTC to reject things like 2026-02-30.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** Shift a YYYY-MM-DD string by whole days without any timezone involvement. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** 870 -> "14:30" */
export function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "14:30" -> 870. Returns null for anything unparseable. */
export function labelToMinutes(label: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Every bookable start time for a salon, as minutes from midnight. */
export function slotsForSalon(salon: {
  opensAtMin: number;
  closesAtMin: number;
  slotMin: number;
}): number[] {
  const slots: number[] = [];
  if (salon.slotMin <= 0) return slots;
  for (let t = salon.opensAtMin; t < salon.closesAtMin; t += salon.slotMin) {
    slots.push(t);
  }
  return slots;
}

/** Half-open interval overlap: [aStart, aEnd) vs [bStart, bEnd). */
export function rangesOverlap(
  aStart: number,
  aDuration: number,
  bStart: number,
  bDuration: number,
): boolean {
  return aStart < bStart + bDuration && bStart < aStart + aDuration;
}

/**
 * Mirrors the database exclusion constraint so the UI can grey out slots
 * before the user clicks. The database remains the authority — this is a
 * courtesy check, never the guarantee.
 */
export function conflictsWithExisting(
  candidate: { startMin: number; durationMin: number },
  existing: Array<{
    id: string;
    startMin: number;
    durationMin: number;
    status: string;
  }>,
  ignoreBookingId?: string,
): boolean {
  return existing.some(
    (b) =>
      b.status !== "cancelled" &&
      b.id !== ignoreBookingId &&
      rangesOverlap(
        candidate.startMin,
        candidate.durationMin,
        b.startMin,
        b.durationMin,
      ),
  );
}

export function formatLongDate(dateStr: string, locale = "fr-FR"): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * All salon times are handled as "minutes from midnight, salon-local" plus a
 * plain YYYY-MM-DD date string. Nothing in the booking path constructs a
 * `Date` from user input, so a server running in UTC and a browser running in
 * Africa/Casablanca can never disagree about which day a booking is on.
 *
 * Every function here is total: given rubbish it returns a sensible value or
 * null rather than throwing. These are called during server rendering, where
 * an uncaught RangeError from `Intl` is a blank 500 page rather than a
 * mis-rendered date.
 */

export const SALON_TIME_ZONE = "Africa/Casablanca";

/** Minutes in a day. A booking may end exactly here, never past it. */
export const MINUTES_IN_DAY = 1440;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Africa/Casablanca is only available when Node was built with full ICU.
 * Every supported runtime (Node 20+, Vercel) has it, but a stripped build
 * would otherwise throw a RangeError out of a server component. Resolved once
 * and cached: `supportedValuesOf` is not cheap enough to call per request.
 */
let timeZoneChecked = false;
let timeZoneUsable = true;

function salonTimeZone(): string | undefined {
  if (!timeZoneChecked) {
    timeZoneChecked = true;
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: SALON_TIME_ZONE }).format(
        new Date(0),
      );
      timeZoneUsable = true;
    } catch {
      timeZoneUsable = false;
    }
  }
  // undefined means "the runtime's own zone", which on Vercel is UTC — one
  // hour off Casablanca rather than a crashed page.
  return timeZoneUsable ? SALON_TIME_ZONE : undefined;
}

function isRealDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Today's calendar date in the salons' own timezone, as YYYY-MM-DD. */
export function todayInSalonTz(now: Date = new Date()): string {
  const when = isRealDate(now) ? now : new Date();
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: salonTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
}

/** Current time of day in the salons' timezone, as minutes from midnight. */
export function nowMinutesInSalonTz(now: Date = new Date()): number {
  const when = isRealDate(now) ? now : new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: salonTimeZone(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(when);
  const [h, m] = parts.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  // "24:00" is a legal en-GB rendering of midnight in some ICU versions.
  return (h % 24) * 60 + m;
}

export function isValidDateString(value: unknown): boolean {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Postgres `date` tops out well beyond this; the narrower window keeps
  // typos like year 0202 out of the database.
  if (y < 2000 || y > 2100) return false;
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
  if (!isValidDateString(dateStr) || !Number.isFinite(days)) return dateStr;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Math.trunc(days));
  return dt.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  if (!isValidDateString(from) || !isValidDateString(to)) return 0;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86_400_000);
}

/** 870 -> "14:30" */
export function minutesToLabel(minutes: number): string {
  if (!Number.isFinite(minutes)) return "--:--";
  const total = Math.trunc(minutes);
  // 1440 is a legal *end* time and must render as 24:00, not 00:00, or a
  // booking that runs to closing looks like it ends at midnight.
  const h = Math.floor(total / 60);
  const m = ((total % 60) + 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "14:30" -> 870. Returns null for anything unparseable. */
export function labelToMinutes(label: string): number | null {
  if (typeof label !== "string") return null;
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
  const { opensAtMin, closesAtMin, slotMin } = salon;
  // A zero or negative slot length would loop forever. It cannot reach here
  // any more — the salons table has a CHECK constraint — but this function is
  // also called on data that arrived over the wire.
  if (!Number.isFinite(slotMin) || slotMin <= 0) return slots;
  if (!Number.isFinite(opensAtMin) || !Number.isFinite(closesAtMin)) return slots;
  for (let t = opensAtMin; t < closesAtMin; t += slotMin) {
    slots.push(t);
  }
  return slots;
}

/**
 * Whether a slot is over, as of `nowMin` on the same day.
 *
 * A slot is past only once it has *ended*: at 14:10 the 14:00 slot is still
 * running and can take a walk-in. The grids, the booking sheet and the server
 * all decide with this one function — when the server used its own stricter
 * rule, the grid offered 14:00 at 14:10 and the booking then bounced.
 */
export function isSlotOver(startMin: number, slotMin: number, nowMin: number): boolean {
  return startMin + slotMin <= nowMin;
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
 * Checks if one candidate service collides with an existing booking's
 * services. Note: Different services at the same salon/time are permitted
 * concurrently. A conflict only occurs when the same service overlaps the
 * same time range — each existing booking is checked service by service,
 * since an appointment with several services occupies one chair per service,
 * not one chair for its whole span.
 */
export function conflictsWithExisting(
  candidate: { startMin: number; durationMin: number; service?: string },
  existing: Array<{
    id: string;
    status: string;
    services: Array<{ service: string; startMin: number; durationMin: number }>;
  }>,
  ignoreBookingId?: string,
): boolean {
  return existing.some(
    (b) =>
      b.status !== "cancelled" &&
      b.id !== ignoreBookingId &&
      b.services.some(
        (s) =>
          (!candidate.service ||
            candidate.service.trim().toLowerCase() === s.service.trim().toLowerCase()) &&
          rangesOverlap(candidate.startMin, candidate.durationMin, s.startMin, s.durationMin),
      ),
  );
}

/** First of the month a date falls in, as YYYY-MM-DD. */
export function startOfMonth(dateStr: string): string {
  if (!isValidDateString(dateStr)) return dateStr;
  const [y, m] = dateStr.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * Shift a YYYY-MM-DD string by whole months. The day is clamped to the
 * target month's last day (31 Jan + 1 month -> 28/29 Feb, never a rollover
 * into March) rather than relying on `Date`'s own overflow behaviour.
 */
export function addMonths(dateStr: string, months: number): string {
  if (!isValidDateString(dateStr) || !Number.isFinite(months)) return dateStr;
  const [y, m, d] = dateStr.split("-").map(Number);
  const totalMonthIndex = (m - 1) + Math.trunc(months);
  const targetYear = y + Math.floor(totalMonthIndex / 12);
  const targetMonth = ((totalMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const day = Math.min(d, lastDayOfTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonth, day))
    .toISOString()
    .slice(0, 10);
}

/** 0 for Monday through 6 for Sunday: French calendars start on Monday. */
export function weekdayIndex(dateStr: string): number {
  if (!isValidDateString(dateStr)) return 0;
  const [y, m, d] = dateStr.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The seven dates, Monday to Sunday, of the week a date falls in. */
export function weekDates(dateStr: string): string[] {
  const offset = weekdayIndex(dateStr);
  return Array.from({ length: 7 }, (_, i) => addDays(dateStr, i - offset));
}

/**
 * The full set of weeks (Monday first) covering the month a date falls in —
 * 35 or 42 cells, always a whole number of 7-day rows, with the leading and
 * trailing days from adjacent months included so the grid has no gaps.
 */
export function monthMatrix(
  dateStr: string,
): { date: string; inMonth: boolean }[] {
  if (!isValidDateString(dateStr)) return [];
  const [y, m] = dateStr.split("-").map(Number);
  const firstWeekday = weekdayIndex(`${y}-${String(m).padStart(2, "0")}-01`);
  const daysInThisMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const totalCells = firstWeekday + daysInThisMonth <= 35 ? 35 : 42;

  const cells: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(Date.UTC(y, m - 1, 1 - firstWeekday + i));
    cells.push({
      date: d.toISOString().slice(0, 10),
      inMonth: d.getUTCMonth() === m - 1,
    });
  }
  return cells;
}

/** "2025-09-08" -> { month: "septembre", year: "2025" } */
export function formatMonthYear(
  dateStr: string,
  locale = "fr-FR",
): { month: string; year: string } {
  if (!isValidDateString(dateStr)) return { month: "", year: "" };
  const [y, m] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  const month = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  }).format(dt);
  return { month, year: String(y) };
}

function utcDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const DAY_TITLE_FMT = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const DAY_SHORT_FMT = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const DAY_MONTH_FMT = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** "mardi 15 septembre", with the year only when it is not `today`'s. */
export function formatDayTitle(dateStr: string, today: string): string {
  if (!isValidDateString(dateStr)) return String(dateStr ?? "");
  const title = DAY_TITLE_FMT.format(utcDate(dateStr));
  return dateStr.slice(0, 4) === String(today).slice(0, 4) ? title : `${title} ${dateStr.slice(0, 4)}`;
}

/** "mar. 15 sept." */
export function formatShortDate(dateStr: string): string {
  if (!isValidDateString(dateStr)) return String(dateStr ?? "");
  return DAY_SHORT_FMT.format(utcDate(dateStr));
}

/** "14 au 20 septembre", "28 septembre au 4 octobre". */
export function formatDateRange(from: string, to: string): string {
  if (!isValidDateString(from) || !isValidDateString(to)) return `${from} ${to}`;
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const start = sameMonth ? String(Number(from.slice(8))) : DAY_MONTH_FMT.format(utcDate(from));
  return `${start} au ${DAY_MONTH_FMT.format(utcDate(to))}`;
}

/** "Aujourd'hui", "Demain", "Hier", or null. */
export function relativeDayLabel(dateStr: string, today: string): string | null {
  const delta = daysBetween(today, dateStr);
  if (!isValidDateString(dateStr) || !isValidDateString(today)) return null;
  if (delta === 0) return "Aujourd'hui";
  if (delta === 1) return "Demain";
  if (delta === -1) return "Hier";
  return null;
}

export function formatLongDate(dateStr: string, locale = "fr-FR"): string {
  if (!isValidDateString(dateStr)) return String(dateStr ?? "");
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

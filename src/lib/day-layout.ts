import { isSlotOver } from "./time";

/**
 * Placing a salon's day on a time axis when several services run at once.
 *
 * Bookings that overlap in time are grouped into clusters, and each cluster
 * is split into side-by-side lanes: four services at 17:00 sit as four
 * columns, not as four cards stacked on top of one another. A booking then
 * widens into the lanes to its right that are free for its whole length, so
 * a quiet morning still gets full-width cards. Pure functions, no DOM: the
 * timeline turns `lane` / `span` / `lanes` into percentages.
 */

export type TimedBooking = {
  id: string;
  startMin: number;
  durationMin: number;
};

export type LaidOutBooking<T extends TimedBooking> = {
  booking: T;
  /** Zero-based column within its cluster. */
  lane: number;
  /** How many columns it covers, from `lane` rightwards. */
  span: number;
  /** Columns in its cluster. */
  lanes: number;
  /** Visual start and end in minutes: a card is never shorter than a slot. */
  top: number;
  bottom: number;
};

/**
 * Bookings that lost their seat when a cluster ran past `laneCap`, bundled by
 * the stretch of time they share so the timeline can draw one "+N" badge per
 * pocket of overflow instead of one per booking.
 */
export type OverflowGroup<T extends TimedBooking> = {
  top: number;
  bottom: number;
  bookings: T[];
};

/**
 * `laneCap` bounds how many columns a single instant can ever demand. Beyond
 * it, a booking still occupies its true lane for the packing math (so later
 * bookings keep finding real gaps), but it renders as overflow rather than as
 * a lane so thin its own name cannot fit — four wide, readable columns beat
 * eleven that are each a sliver. Uncapped by default: tests and any caller
 * that wants true concurrency get the old, exact behaviour.
 */
export function layoutDay<T extends TimedBooking>(
  bookings: readonly T[],
  slotMin: number,
  laneCap: number = Infinity,
): { items: LaidOutBooking<T>[]; overflow: OverflowGroup<T>[]; maxLanes: number } {
  const minSpan = Math.max(1, slotMin);
  const cap = Math.max(1, laneCap);
  const sorted = [...bookings].sort(
    (a, b) =>
      a.startMin - b.startMin ||
      b.durationMin - a.durationMin ||
      a.id.localeCompare(b.id),
  );

  const items: LaidOutBooking<T>[] = [];
  const overflow: OverflowGroup<T>[] = [];
  let maxLanes = 0;
  let cluster: LaidOutBooking<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const closeCluster = () => {
    if (cluster.length === 0) return;
    const realLanes = laneEnds.length;
    const lanes = Math.min(realLanes, cap);
    maxLanes = Math.max(maxLanes, lanes);

    const visible = cluster.filter((item) => item.lane < lanes);
    const hidden = cluster.filter((item) => item.lane >= lanes);

    for (const item of visible) {
      item.lanes = lanes;
      // Widen into every following visible lane that is free for this
      // booking's whole visual interval.
      let span = 1;
      for (let lane = item.lane + 1; lane < lanes; lane += 1) {
        const blocked = visible.some(
          (other) =>
            other.lane === lane && other.top < item.bottom && item.top < other.bottom,
        );
        if (blocked) break;
        span += 1;
      }
      item.span = span;
    }
    items.push(...visible);

    // Hidden bookings, bundled into as few badges as the overlaps allow: two
    // that never run at the same time share one badge rather than stacking
    // two "+1"s.
    const sortedHidden = [...hidden].sort((a, b) => a.top - b.top);
    let group: LaidOutBooking<T>[] = [];
    let groupEnd = -Infinity;
    const flushGroup = () => {
      if (group.length === 0) return;
      overflow.push({
        top: Math.min(...group.map((g) => g.top)),
        bottom: Math.max(...group.map((g) => g.bottom)),
        bookings: group.map((g) => g.booking),
      });
      group = [];
      groupEnd = -Infinity;
    };
    for (const h of sortedHidden) {
      if (h.top >= groupEnd) flushGroup();
      group.push(h);
      groupEnd = Math.max(groupEnd, h.bottom);
    }
    flushGroup();

    cluster = [];
    laneEnds = [];
  };

  for (const booking of sorted) {
    const top = booking.startMin;
    const bottom = booking.startMin + Math.max(booking.durationMin, minSpan);
    if (top >= clusterEnd) {
      closeCluster();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= top);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(bottom);
    } else {
      laneEnds[lane] = bottom;
    }
    cluster.push({ booking, lane, span: 1, lanes: 1, top, bottom });
    clusterEnd = Math.max(clusterEnd, bottom);
  }
  closeCluster();

  return { items, overflow, maxLanes };
}

type SalonHours = { opensAtMin: number; closesAtMin: number; slotMin: number };

function alignDown(minute: number, salon: SalonHours): number {
  const slot = Math.max(1, salon.slotMin);
  return salon.opensAtMin + Math.floor((minute - salon.opensAtMin) / slot) * slot;
}

function alignUp(minute: number, salon: SalonHours): number {
  const slot = Math.max(1, salon.slotMin);
  return salon.opensAtMin + Math.ceil((minute - salon.opensAtMin) / slot) * slot;
}

/**
 * The stretch of the day the timeline draws: opening to closing, widened on
 * the slot grid to take in any booking that sits outside today's hours
 * (hours changed after it was made), so no booking is ever off the canvas.
 */
export function timelineBounds(
  salon: SalonHours,
  bookings: readonly TimedBooking[],
): { startMin: number; endMin: number } {
  let startMin = salon.opensAtMin;
  let endMin = salon.closesAtMin;
  for (const b of bookings) {
    startMin = Math.min(startMin, alignDown(b.startMin, salon));
    endMin = Math.max(endMin, alignUp(b.startMin + Math.max(b.durationMin, salon.slotMin), salon));
  }
  return { startMin: Math.max(0, startMin), endMin: Math.min(24 * 60, Math.max(endMin, startMin + 1)) };
}

/** The first start time on the grid that has not ended yet at `nowMin`. */
export function firstOpenSlotStart(salon: SalonHours, nowMin: number | null): number {
  if (nowMin === null || nowMin <= salon.opensAtMin) return salon.opensAtMin;
  // A slot stays bookable until it has ended (see isSlotOver), so the
  // current slot is still open.
  return alignDown(nowMin, salon);
}

/**
 * Stretches with nothing booked at all, from `fromMin` to closing, each
 * starting on the slot grid and at least `minLength` long. What the front
 * desk means by "a free moment": several services can run at once, so a
 * time with any booking is not offered as empty.
 */
export function freeWindows(
  bookings: readonly { startMin: number; durationMin: number }[],
  salon: SalonHours,
  fromMin: number = salon.opensAtMin,
  minLength: number = salon.slotMin,
): { startMin: number; endMin: number }[] {
  const intervals = bookings
    .map((b) => [b.startMin, b.startMin + b.durationMin] as const)
    .sort((a, b) => a[0] - b[0]);
  const windows: { startMin: number; endMin: number }[] = [];
  let cursor = Math.max(salon.opensAtMin, fromMin);

  const push = (end: number) => {
    const start = alignUp(cursor, salon);
    const stop = Math.min(end, salon.closesAtMin);
    if (stop - start >= Math.max(1, minLength)) windows.push({ startMin: start, endMin: stop });
  };

  for (const [start, end] of intervals) {
    if (end <= cursor) continue;
    if (start > cursor) push(start);
    cursor = Math.max(cursor, end);
    if (cursor >= salon.closesAtMin) break;
  }
  if (cursor < salon.closesAtMin) push(salon.closesAtMin);
  return windows;
}

/** Share of opening hours (0-100) with at least one service running. */
export function occupancy(
  bookings: readonly { startMin: number; durationMin: number }[],
  salon: SalonHours,
): number {
  const open = salon.closesAtMin - salon.opensAtMin;
  if (open <= 0) return 0;
  const sorted = [...bookings].sort((a, b) => a.startMin - b.startMin);
  let covered = 0;
  let cursor = salon.opensAtMin;
  for (const b of sorted) {
    const end = Math.min(salon.closesAtMin, b.startMin + b.durationMin);
    const start = Math.max(cursor, b.startMin);
    if (end > start) covered += end - start;
    cursor = Math.max(cursor, end);
  }
  return Math.min(100, Math.round((covered / open) * 100));
}

/** The most services running at the same moment, and when that first happens. */
export function peakConcurrency(
  bookings: readonly { startMin: number; durationMin: number }[],
): { count: number; atMin: number | null } {
  const events: [number, number][] = [];
  for (const b of bookings) {
    if (b.durationMin <= 0) continue;
    events.push([b.startMin, 1], [b.startMin + b.durationMin, -1]);
  }
  // An ending and a start at the same minute do not overlap.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let running = 0;
  let count = 0;
  let atMin: number | null = null;
  for (const [minute, delta] of events) {
    running += delta;
    if (running > count) {
      count = running;
      atMin = minute;
    }
  }
  return { count, atMin };
}

/** How a booking reads right now, for colour, order and wording. */
export type BookingPhase = "cancelled" | "done" | "running" | "ended" | "upcoming";

export function bookingPhase(
  booking: { status: string; startMin: number; durationMin: number; bookingDate: string },
  today: string,
  nowMin: number,
): BookingPhase {
  if (booking.status === "cancelled") return "cancelled";
  if (booking.status === "done") return "done";
  if (booking.bookingDate < today) return "ended";
  if (booking.bookingDate > today) return "upcoming";
  if (booking.startMin + booking.durationMin <= nowMin) return "ended";
  if (booking.startMin <= nowMin) return "running";
  return "upcoming";
}

/** "2 h 30", "45 min", "1 h": how a duration is said at the front desk. */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}

/** "dans 7 min", "dans 1 h 05", "maintenant". */
export function formatStartsIn(startMin: number, nowMin: number): string {
  const delta = startMin - nowMin;
  if (delta <= 0) return "maintenant";
  return `dans ${formatDuration(delta)}`;
}

/** "reste 25 min". */
export function formatRemaining(endMin: number, nowMin: number): string {
  const delta = endMin - nowMin;
  return delta <= 0 ? "terminé" : `reste ${formatDuration(delta)}`;
}

/**
 * The start times a booking of `durationMin` can take for `service`, with
 * the reason each unavailable one is refused — what the booking sheet draws
 * as its time grid, computed from what the screen already knows, with no
 * request.
 */
export type SlotAvailability = {
  startMin: number;
  state: "free" | "taken" | "past" | "overflow";
};

export function slotAvailability(
  salon: { opensAtMin: number; closesAtMin: number; slotMin: number },
  slots: readonly number[],
  candidate: { durationMin: number; service: string },
  isTaken: (startMin: number) => boolean,
  nowMin: number | null,
): SlotAvailability[] {
  return slots.map((startMin) => {
    if (nowMin !== null && isSlotOver(startMin, salon.slotMin, nowMin)) {
      return { startMin, state: "past" };
    }
    if (startMin + candidate.durationMin > salon.closesAtMin) {
      return { startMin, state: "overflow" };
    }
    return { startMin, state: isTaken(startMin) ? "taken" : "free" };
  });
}

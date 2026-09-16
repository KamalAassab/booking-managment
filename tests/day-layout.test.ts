import { describe, expect, it } from "vitest";

import {
  bookingPhase,
  firstOpenSlotStart,
  formatDuration,
  formatRemaining,
  formatStartsIn,
  freeWindows,
  layoutDay,
  occupancy,
  peakConcurrency,
  slotAvailability,
  timelineBounds,
} from "@/lib/day-layout";

/**
 * The timeline's geometry. Two cards drawn over each other is a booking the
 * front desk cannot read; a card squeezed into a lane it did not need is
 * a name it cannot read. Both are checked for every configuration a busy
 * salon produces.
 */

const b = (id: string, startMin: number, durationMin: number) => ({ id, startMin, durationMin });

function overlaps(a: { top: number; bottom: number }, c: { top: number; bottom: number }) {
  return a.top < c.bottom && c.top < a.bottom;
}

/** No two laid-out cards share any column at any minute. */
function assertNoVisualOverlap(items: ReturnType<typeof layoutDay>["items"]) {
  for (const x of items) {
    for (const y of items) {
      if (x === y || !overlaps(x, y)) continue;
      const xCols = new Set(Array.from({ length: x.span }, (_, i) => x.lane + i));
      const yCols = Array.from({ length: y.span }, (_, i) => y.lane + i);
      // Lane indices are only comparable within one cluster; overlapping
      // items always share a cluster, so they must share a lane count.
      expect(x.lanes).toBe(y.lanes);
      expect(yCols.some((col) => xCols.has(col)), `${x.booking.id} and ${y.booking.id} overlap`).toBe(false);
    }
    expect(x.lane + x.span).toBeLessThanOrEqual(x.lanes);
  }
}

describe("layoutDay", () => {
  it("gives a lone booking the full width", () => {
    const { items, maxLanes } = layoutDay([b("a", 600, 60)], 30);
    expect(items[0]).toMatchObject({ lane: 0, span: 1, lanes: 1, top: 600, bottom: 660 });
    expect(maxLanes).toBe(1);
  });

  it("keeps back-to-back bookings in one lane", () => {
    const { items, maxLanes } = layoutDay([b("a", 600, 30), b("b", 630, 30), b("c", 660, 60)], 30);
    expect(items.map((i) => i.lane)).toEqual([0, 0, 0]);
    expect(maxLanes).toBe(1);
  });

  it("puts simultaneous services side by side", () => {
    const { items, maxLanes } = layoutDay([b("a", 1020, 60), b("b", 1020, 30), b("c", 1020, 45), b("d", 1020, 90)], 30);
    expect(maxLanes).toBe(4);
    expect(new Set(items.map((i) => i.lane)).size).toBe(4);
    // Longest first, so the lane structure reads left to right by length.
    expect(items[0].booking.id).toBe("d");
    assertNoVisualOverlap(items);
  });

  it("starts a new cluster once the previous one has ended, back at full width", () => {
    const { items } = layoutDay([b("a", 600, 60), b("b", 630, 60), b("c", 720, 30)], 30);
    const c = items.find((i) => i.booking.id === "c")!;
    expect(c).toMatchObject({ lane: 0, lanes: 1, span: 1 });
    expect(items.find((i) => i.booking.id === "a")!.lanes).toBe(2);
  });

  it("widens a card into lanes that are free for its whole length", () => {
    // a runs 10:00-12:00 in lane 0; b and c share lane 1 briefly; d at 11:30
    // is alone in lane 1 but lane 2 was used earlier by c.
    const { items } = layoutDay(
      [b("a", 600, 120), b("b", 600, 30), b("c", 600, 30), b("d", 660, 30)],
      30,
    );
    const d = items.find((i) => i.booking.id === "d")!;
    expect(d.lanes).toBe(3);
    expect(d.lane).toBe(1);
    expect(d.span).toBe(2);
    assertNoVisualOverlap(items);
  });

  it("draws a short service at least one slot tall without colliding with the next", () => {
    const { items } = layoutDay([b("a", 600, 10), b("b", 630, 20)], 30);
    expect(items[0]).toMatchObject({ top: 600, bottom: 630, lane: 0 });
    expect(items[1]).toMatchObject({ top: 630, bottom: 660, lane: 0 });
  });

  it("places a 10-minute service beside a booking that starts inside its visual slot", () => {
    // 10:00 for 10 min is drawn to 10:30, so a booking at 10:15 (off-grid,
    // legacy data) must not be drawn over it.
    const { items } = layoutDay([b("a", 600, 10), b("b", 615, 30)], 30);
    expect(items[0].lane).not.toBe(items[1].lane);
  });

  it("never overlaps cards across 500 randomized busy days", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let day = 0; day < 500; day += 1) {
      const bookings = Array.from({ length: 5 + Math.floor(rand() * 30) }, (_, i) =>
        b(`x${i}`, 540 + Math.floor(rand() * 26) * 30, [10, 20, 30, 45, 60, 90, 120, 180][Math.floor(rand() * 8)]),
      );
      const { items, maxLanes } = layoutDay(bookings, 30);
      expect(items).toHaveLength(bookings.length);
      assertNoVisualOverlap(items);
      expect(maxLanes).toBeGreaterThanOrEqual(1);
    }
  });

  it("is stable regardless of input order", () => {
    const list = [b("a", 600, 60), b("b", 600, 60), b("c", 630, 30), b("d", 690, 30)];
    const forward = layoutDay(list, 30).items.map((i) => `${i.booking.id}:${i.lane}:${i.span}`).sort();
    const backward = layoutDay([...list].reverse(), 30).items.map((i) => `${i.booking.id}:${i.lane}:${i.span}`).sort();
    expect(backward).toEqual(forward);
  });

  it("leaves a cluster untouched when it fits within the lane cap", () => {
    const bookings = [b("a", 600, 30), b("b", 600, 30), b("c", 600, 30)];
    const { items, overflow, maxLanes } = layoutDay(bookings, 30, 4);
    expect(items).toHaveLength(3);
    expect(overflow).toHaveLength(0);
    expect(maxLanes).toBe(3);
  });

  it("caps a busy cluster's lanes and bundles the rest into overflow", () => {
    // Six services at once, capped to 4 visible lanes.
    const bookings = Array.from({ length: 6 }, (_, i) => b(`x${i}`, 600, 30));
    const { items, overflow, maxLanes } = layoutDay(bookings, 30, 4);
    expect(maxLanes).toBe(4);
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.lanes === 4)).toBe(true);
    assertNoVisualOverlap(items);
    expect(overflow).toHaveLength(1);
    expect(overflow[0].bookings).toHaveLength(2);
    expect(overflow[0]).toMatchObject({ top: 600, bottom: 630 });
    // Every booking is accounted for exactly once.
    const seen = new Set([...items.map((i) => i.booking.id), ...overflow.flatMap((g) => g.bookings.map((x) => x.id))]);
    expect(seen.size).toBe(6);
  });

  it("splits overflow into separate badges when the excess bookings don't overlap each other", () => {
    // a runs the whole hour in lane 0; b (600-630) and d (630-660) share
    // lane 1 in sequence. c and e land in lane 2 — beyond the cap — but c
    // and e never overlap each other, so they should not share one badge.
    const bookings = [
      b("a", 600, 60),
      b("b", 600, 30),
      b("c", 600, 30),
      b("d", 630, 30),
      b("e", 630, 30),
    ];
    const { items, overflow } = layoutDay(bookings, 30, 2);
    expect(items).toHaveLength(3);
    expect(overflow).toHaveLength(2);
    const total = overflow.reduce((sum, g) => sum + g.bookings.length, 0);
    expect(total).toBe(2);
  });

  it("never overlaps visible cards across 500 randomized busy days, capped or not", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let day = 0; day < 500; day += 1) {
      const bookings = Array.from({ length: 5 + Math.floor(rand() * 30) }, (_, i) =>
        b(`x${i}`, 540 + Math.floor(rand() * 26) * 30, [10, 20, 30, 45, 60, 90, 120, 180][Math.floor(rand() * 8)]),
      );
      const { items, overflow, maxLanes } = layoutDay(bookings, 30, 4);
      assertNoVisualOverlap(items);
      expect(maxLanes).toBeLessThanOrEqual(4);
      const total = items.length + overflow.reduce((sum, g) => sum + g.bookings.length, 0);
      expect(total).toBe(bookings.length);
    }
  });
});

describe("bookingPhase", () => {
  const today = "2031-06-10";
  const at = (startMin: number, durationMin = 30, status = "confirmed", bookingDate = today) =>
    ({ status, startMin, durationMin, bookingDate });

  it("reads status first, then time", () => {
    expect(bookingPhase(at(600, 30, "cancelled"), today, 900)).toBe("cancelled");
    expect(bookingPhase(at(1200, 30, "done"), today, 900)).toBe("done");
  });

  it("splits today's confirmed bookings into ended, running and upcoming", () => {
    expect(bookingPhase(at(840, 30), today, 870)).toBe("ended");
    expect(bookingPhase(at(840, 60), today, 870)).toBe("running");
    expect(bookingPhase(at(870, 30), today, 870)).toBe("running");
    expect(bookingPhase(at(900, 30), today, 870)).toBe("upcoming");
  });

  it("treats other days by the date alone", () => {
    expect(bookingPhase(at(1400, 30, "confirmed", "2031-06-09"), today, 0)).toBe("ended");
    expect(bookingPhase(at(0, 30, "confirmed", "2031-06-11"), today, 1439)).toBe("upcoming");
  });
});

describe("duration wording", () => {
  it("says durations the way staff do", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(150)).toBe("2 h 30");
    expect(formatDuration(65)).toBe("1 h 05");
    expect(formatDuration(0)).toBe("");
  });

  it("counts down to a start and to an end", () => {
    expect(formatStartsIn(1020, 1013)).toBe("dans 7 min");
    expect(formatStartsIn(1020, 1020)).toBe("maintenant");
    expect(formatRemaining(1110, 1013)).toBe("reste 1 h 37");
    expect(formatRemaining(1000, 1013)).toBe("terminé");
  });
});

describe("timelineBounds", () => {
  const salon = { opensAtMin: 540, closesAtMin: 1200, slotMin: 30 };

  it("is the opening hours when every booking fits inside them", () => {
    expect(timelineBounds(salon, [b("a", 600, 60)])).toEqual({ startMin: 540, endMin: 1200 });
  });

  it("widens on the slot grid to show a booking outside the hours", () => {
    expect(timelineBounds(salon, [b("early", 500, 20), b("late", 1190, 45)])).toEqual({
      startMin: 480,
      endMin: 1260,
    });
  });

  it("never runs past midnight", () => {
    expect(timelineBounds({ opensAtMin: 0, closesAtMin: 1440, slotMin: 30 }, [b("x", 1430, 10)]).endMin).toBe(1440);
  });
});

describe("firstOpenSlotStart", () => {
  const salon = { opensAtMin: 540, closesAtMin: 1200, slotMin: 30 };

  it("keeps the running slot bookable", () => {
    expect(firstOpenSlotStart(salon, 850)).toBe(840);
    expect(firstOpenSlotStart(salon, 840)).toBe(840);
  });

  it("is the opening time before opening and on other days", () => {
    expect(firstOpenSlotStart(salon, 300)).toBe(540);
    expect(firstOpenSlotStart(salon, null)).toBe(540);
  });
});

describe("freeWindows", () => {
  const salon = { opensAtMin: 540, closesAtMin: 720, slotMin: 30 };

  it("is the whole day when nothing is booked", () => {
    expect(freeWindows([], salon)).toEqual([{ startMin: 540, endMin: 720 }]);
  });

  it("finds the holes between overlapping bookings", () => {
    const bookings = [
      { startMin: 600, durationMin: 60 },
      { startMin: 630, durationMin: 15 },
      { startMin: 690, durationMin: 30 },
    ];
    expect(freeWindows(bookings, salon)).toEqual([
      { startMin: 540, endMin: 600 },
      { startMin: 660, endMin: 690 },
    ]);
  });

  it("starts a hole on the slot grid and drops holes shorter than a slot", () => {
    // 09:00-09:40 booked leaves 09:40-10:30 free; the first start on the
    // grid is 10:00, and 10:00-10:30 is exactly one slot.
    const bookings = [
      { startMin: 540, durationMin: 40 },
      { startMin: 630, durationMin: 90 },
    ];
    expect(freeWindows(bookings, salon)).toEqual([{ startMin: 600, endMin: 630 }]);
    expect(freeWindows([{ startMin: 540, durationMin: 50 }, { startMin: 600, durationMin: 120 }], salon)).toEqual([]);
  });

  it("ignores what is already behind the clock", () => {
    expect(freeWindows([], salon, 660)).toEqual([{ startMin: 660, endMin: 720 }]);
  });
});

describe("occupancy", () => {
  const salon = { opensAtMin: 600, closesAtMin: 700, slotMin: 30 };

  it("counts overlapping services once and ignores time outside the hours", () => {
    expect(occupancy([], salon)).toBe(0);
    expect(occupancy([b("a", 600, 50), b("b", 620, 10)], salon)).toBe(50);
    expect(occupancy([b("early", 560, 60), b("late", 680, 60)], salon)).toBe(40);
    expect(occupancy([b("all", 500, 400)], salon)).toBe(100);
  });
});

describe("peakConcurrency", () => {
  it("counts the most services running at once, not back-to-back ones", () => {
    expect(peakConcurrency([b("a", 600, 30), b("b", 630, 30)])).toEqual({ count: 1, atMin: 600 });
    expect(
      peakConcurrency([b("a", 600, 120), b("b", 630, 30), b("c", 640, 60), b("d", 700, 10)]),
    ).toEqual({ count: 3, atMin: 640 });
    expect(peakConcurrency([])).toEqual({ count: 0, atMin: null });
  });
});

describe("slotAvailability", () => {
  const salon = { opensAtMin: 540, closesAtMin: 660, slotMin: 30 };
  const slots = [540, 570, 600, 630];

  it("marks each start as free, taken for this service, already over, or running past closing", () => {
    const result = slotAvailability(salon, slots, { durationMin: 60, service: "Coupe" }, (s) => s === 570, 575);
    expect(result).toEqual([
      { startMin: 540, state: "past" },
      { startMin: 570, state: "taken" },
      { startMin: 600, state: "free" },
      { startMin: 630, state: "overflow" },
    ]);
  });

  it("ignores the clock on another day", () => {
    const result = slotAvailability(salon, slots, { durationMin: 30, service: "Coupe" }, () => false, null);
    expect(result.every((s) => s.state === "free")).toBe(true);
  });
});

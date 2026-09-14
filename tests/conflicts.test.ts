import { describe, expect, it } from "vitest";

import {
  addDays,
  conflictsWithExisting,
  isValidDateString,
  labelToMinutes,
  minutesToLabel,
  rangesOverlap,
  slotsForSalon,
} from "@/lib/time";

/**
 * Double-booking is the failure this business actually cannot absorb: two
 * clients told to arrive at 15:00 for the same chair. The authority is the
 * database exclusion constraint in drizzle/0001_no_overlap.sql — these tests
 * cover the client-side mirror of it, so the two cannot drift apart and let
 * the UI offer a slot the database will reject.
 */

const booking = (
  id: string,
  startMin: number,
  durationMin: number,
  status = "confirmed",
  service = "Coloration",
) => ({ id, startMin, durationMin, status, service });

describe("rangesOverlap", () => {
  it("treats intervals as half-open so back-to-back bookings fit", () => {
    // 14:00–14:30 then 14:30–15:00 must both be bookable.
    expect(rangesOverlap(840, 30, 870, 30)).toBe(false);
    expect(rangesOverlap(870, 30, 840, 30)).toBe(false);
  });

  it("detects an identical slot", () => {
    expect(rangesOverlap(840, 30, 840, 30)).toBe(true);
  });

  it("detects a partial overlap from either direction", () => {
    expect(rangesOverlap(840, 60, 870, 30)).toBe(true);
    expect(rangesOverlap(870, 30, 840, 60)).toBe(true);
  });

  it("detects a booking fully contained in a longer one", () => {
    expect(rangesOverlap(840, 120, 870, 30)).toBe(true);
    expect(rangesOverlap(870, 30, 840, 120)).toBe(true);
  });
});

describe("conflictsWithExisting", () => {
  const existing = [
    booking("a", 600, 30, "confirmed", "Manucure"), // 10:00–10:30
    booking("b", 840, 90, "confirmed", "Coloration"), // 14:00–15:30 (a coloration)
  ];

  it("allows a free slot", () => {
    expect(conflictsWithExisting({ startMin: 660, durationMin: 30, service: "Manucure" }, existing)).toBe(
      false,
    );
  });

  it("allows a DIFFERENT service on the EXACT same time slot", () => {
    // 10:00–10:30 is taken by "Manucure", but "Brushing" is a different service and allowed!
    expect(
      conflictsWithExisting({ startMin: 600, durationMin: 30, service: "Brushing" }, existing),
    ).toBe(false);
    // 14:00–15:30 is taken by "Coloration", but "Coupe Simple" is allowed!
    expect(
      conflictsWithExisting({ startMin: 840, durationMin: 30, service: "Coupe Simple" }, existing),
    ).toBe(false);
  });

  it("blocks the SAME service on the exact slot of an existing booking", () => {
    expect(
      conflictsWithExisting({ startMin: 600, durationMin: 30, service: "Manucure" }, existing),
    ).toBe(true);
  });

  it("blocks the SAME service when swallowed by a longer booking", () => {
    // 14:30 and 15:00 for Coloration are inside the 90-minute Coloration.
    expect(
      conflictsWithExisting({ startMin: 870, durationMin: 30, service: "Coloration" }, existing),
    ).toBe(true);
    expect(
      conflictsWithExisting({ startMin: 900, durationMin: 30, service: "Coloration" }, existing),
    ).toBe(true);
  });

  it("blocks a new long booking of the SAME service that would run into an existing one", () => {
    // 13:30 + 60min ends at 14:30, colliding with the 14:00 Coloration.
    expect(
      conflictsWithExisting({ startMin: 810, durationMin: 60, service: "Coloration" }, existing),
    ).toBe(true);
  });

  it("allows a booking that ends exactly when another starts", () => {
    expect(
      conflictsWithExisting({ startMin: 780, durationMin: 60, service: "Coloration" }, existing),
    ).toBe(false);
  });

  it("ignores cancelled bookings so the slot is reusable", () => {
    const withCancelled = [booking("c", 600, 30, "cancelled", "Manucure")];
    expect(
      conflictsWithExisting({ startMin: 600, durationMin: 30, service: "Manucure" }, withCancelled),
    ).toBe(false);
  });

  it("still blocks against bookings marked done for the same service", () => {
    const withDone = [booking("d", 600, 30, "done", "Manucure")];
    expect(
      conflictsWithExisting({ startMin: 600, durationMin: 30, service: "Manucure" }, withDone),
    ).toBe(true);
  });

  it("does not consider a booking to conflict with itself when edited", () => {
    expect(
      conflictsWithExisting({ startMin: 840, durationMin: 90, service: "Coloration" }, existing, "b"),
    ).toBe(false);
  });

  it("still catches a conflict when an edited booking is moved onto another of the same service", () => {
    expect(
      conflictsWithExisting({ startMin: 600, durationMin: 30, service: "Manucure" }, existing, "b"),
    ).toBe(true);
  });
});

describe("slotsForSalon", () => {
  it("generates every start time inside opening hours", () => {
    const slots = slotsForSalon({
      opensAtMin: 9 * 60,
      closesAtMin: 11 * 60,
      slotMin: 30,
    });
    expect(slots).toEqual([540, 570, 600, 630]);
  });

  it("never generates a slot starting at closing time", () => {
    const slots = slotsForSalon({
      opensAtMin: 9 * 60,
      closesAtMin: 20 * 60,
      slotMin: 30,
    });
    expect(slots.at(-1)).toBe(19 * 60 + 30);
  });

  it("returns nothing rather than looping forever on a bad slot length", () => {
    expect(
      slotsForSalon({ opensAtMin: 540, closesAtMin: 1200, slotMin: 0 }),
    ).toEqual([]);
  });
});

describe("date and time helpers", () => {
  it("round-trips minute labels", () => {
    expect(minutesToLabel(0)).toBe("00:00");
    expect(minutesToLabel(870)).toBe("14:30");
    expect(labelToMinutes("14:30")).toBe(870);
    expect(labelToMinutes("9:05")).toBe(545);
    expect(labelToMinutes("25:00")).toBeNull();
    expect(labelToMinutes("nope")).toBeNull();
  });

  it("rejects impossible calendar dates", () => {
    expect(isValidDateString("2026-09-07")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("07/09/2026")).toBe(false);
  });

  it("shifts days across month and year boundaries", () => {
    expect(addDays("2026-09-07", 1)).toBe("2026-09-08");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    // 2028 is a leap year.
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

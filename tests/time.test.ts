import { describe, expect, it } from "vitest";

import {
  MINUTES_IN_DAY,
  addDays,
  conflictsWithExisting,
  daysBetween,
  formatLongDate,
  isValidDateString,
  labelToMinutes,
  minutesToLabel,
  nowMinutesInSalonTz,
  rangesOverlap,
  slotsForSalon,
  todayInSalonTz,
} from "@/lib/time";

describe("isValidDateString", () => {
  it("accepts a well-formed date", () => {
    expect(isValidDateString("2026-09-07")).toBe(true);
    expect(isValidDateString("2026-01-01")).toBe(true);
    expect(isValidDateString("2026-12-31")).toBe(true);
  });

  it("accepts a real leap day and rejects a fabricated one", () => {
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("2026-02-29")).toBe(false);
    expect(isValidDateString("2100-02-29")).toBe(false); // not a leap year
  });

  it("rejects a day that does not exist in its month", () => {
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-04-31")).toBe(false);
    expect(isValidDateString("2026-06-31")).toBe(false);
  });

  it("rejects out-of-range months and days", () => {
    expect(isValidDateString("2026-00-10")).toBe(false);
    expect(isValidDateString("2026-13-10")).toBe(false);
    expect(isValidDateString("2026-05-00")).toBe(false);
    expect(isValidDateString("2026-05-32")).toBe(false);
  });

  it("rejects the wrong shape", () => {
    expect(isValidDateString("2026-9-7")).toBe(false);
    expect(isValidDateString("07/09/2026")).toBe(false);
    expect(isValidDateString("2026-09-07T10:00:00Z")).toBe(false);
    expect(isValidDateString("")).toBe(false);
    expect(isValidDateString("hier")).toBe(false);
  });

  it("rejects years outside the window a salon could plausibly book", () => {
    // A typo like 0202 used to reach the database and produce a row nobody
    // could navigate to.
    expect(isValidDateString("0202-09-07")).toBe(false);
    expect(isValidDateString("1999-09-07")).toBe(false);
    expect(isValidDateString("2101-09-07")).toBe(false);
    expect(isValidDateString("2100-12-31")).toBe(true);
  });

  it("rejects non-strings without throwing", () => {
    expect(isValidDateString(null)).toBe(false);
    expect(isValidDateString(undefined)).toBe(false);
    expect(isValidDateString(20260907)).toBe(false);
    expect(isValidDateString({})).toBe(false);
  });
});

describe("addDays", () => {
  it("moves forward and backward", () => {
    expect(addDays("2026-09-07", 1)).toBe("2026-09-08");
    expect(addDays("2026-09-07", -1)).toBe("2026-09-06");
    expect(addDays("2026-09-07", 0)).toBe("2026-09-07");
  });

  it("crosses month and year boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("crosses a leap day correctly", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("is stable across a DST change in the salons' timezone", () => {
    // Morocco shifts around Ramadan. Because this is pure string arithmetic
    // through UTC, no clock change can make a day appear twice or vanish.
    for (const date of ["2026-03-21", "2026-03-22", "2026-04-18", "2026-10-24"]) {
      expect(addDays(addDays(date, 1), -1)).toBe(date);
    }
  });

  it("returns the input unchanged rather than throwing on bad input", () => {
    expect(addDays("not-a-date", 1)).toBe("not-a-date");
    expect(addDays("2026-09-07", Number.NaN)).toBe("2026-09-07");
    expect(addDays("2026-09-07", Infinity)).toBe("2026-09-07");
  });

  it("round-trips over a long span", () => {
    let date = "2026-01-01";
    for (let i = 0; i < 400; i += 1) date = addDays(date, 1);
    expect(date).toBe("2027-02-05");
    expect(daysBetween("2026-01-01", date)).toBe(400);
  });
});

describe("daysBetween", () => {
  it("counts whole days in both directions", () => {
    expect(daysBetween("2026-09-07", "2026-09-08")).toBe(1);
    expect(daysBetween("2026-09-08", "2026-09-07")).toBe(-1);
    expect(daysBetween("2026-09-07", "2026-09-07")).toBe(0);
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(364);
  });

  it("returns 0 for unparseable input", () => {
    expect(daysBetween("x", "2026-09-07")).toBe(0);
  });
});

describe("minutesToLabel / labelToMinutes", () => {
  it("formats minutes from midnight", () => {
    expect(minutesToLabel(0)).toBe("00:00");
    expect(minutesToLabel(540)).toBe("09:00");
    expect(minutesToLabel(870)).toBe("14:30");
    expect(minutesToLabel(1439)).toBe("23:59");
  });

  it("renders the end of the day as 24:00, not as midnight", () => {
    // A booking that runs to closing has end == 1440. Showing "00:00" there
    // would read as the small hours of the next morning.
    expect(minutesToLabel(MINUTES_IN_DAY)).toBe("24:00");
  });

  it("parses a label back to minutes", () => {
    expect(labelToMinutes("00:00")).toBe(0);
    expect(labelToMinutes("09:00")).toBe(540);
    expect(labelToMinutes("14:30")).toBe(870);
    expect(labelToMinutes("9:00")).toBe(540);
    expect(labelToMinutes(" 14:30 ")).toBe(870);
  });

  it("round-trips every minute of the day", () => {
    for (let m = 0; m < MINUTES_IN_DAY; m += 1) {
      expect(labelToMinutes(minutesToLabel(m))).toBe(m);
    }
  });

  it("rejects unparseable labels", () => {
    expect(labelToMinutes("24:00")).toBeNull();
    expect(labelToMinutes("14:60")).toBeNull();
    expect(labelToMinutes("14h30")).toBeNull();
    expect(labelToMinutes("midi")).toBeNull();
    expect(labelToMinutes("")).toBeNull();
    expect(labelToMinutes(null as unknown as string)).toBeNull();
  });

  it("does not throw on non-finite minutes", () => {
    expect(minutesToLabel(Number.NaN)).toBe("--:--");
    expect(minutesToLabel(Infinity)).toBe("--:--");
  });
});

describe("slotsForSalon", () => {
  it("generates every bookable start time", () => {
    const slots = slotsForSalon({ opensAtMin: 540, closesAtMin: 660, slotMin: 30 });
    expect(slots).toEqual([540, 570, 600, 630]);
  });

  it("excludes the closing time itself — nothing may start at closing", () => {
    const slots = slotsForSalon({ opensAtMin: 540, closesAtMin: 1200, slotMin: 30 });
    expect(slots.at(-1)).toBe(1170);
    expect(slots).not.toContain(1200);
    expect(slots).toHaveLength(22);
  });

  it("honours a salon with different hours", () => {
    // The barber shop closes an hour later than the other two.
    const barber = slotsForSalon({ opensAtMin: 540, closesAtMin: 1260, slotMin: 30 });
    expect(barber).toHaveLength(24);
    expect(barber.at(-1)).toBe(1230);
  });

  it("honours a non-30-minute grid", () => {
    expect(
      slotsForSalon({ opensAtMin: 540, closesAtMin: 600, slotMin: 15 }),
    ).toEqual([540, 555, 570, 585]);
  });

  it("returns nothing rather than looping forever on a zero slot length", () => {
    // A slot_min of 0 is now refused by the salons_slot_positive constraint,
    // but this function also runs on data that arrived over the wire.
    expect(slotsForSalon({ opensAtMin: 540, closesAtMin: 1200, slotMin: 0 })).toEqual([]);
    expect(slotsForSalon({ opensAtMin: 540, closesAtMin: 1200, slotMin: -30 })).toEqual([]);
  });

  it("returns nothing when the salon closes before it opens", () => {
    expect(slotsForSalon({ opensAtMin: 1200, closesAtMin: 540, slotMin: 30 })).toEqual([]);
    expect(slotsForSalon({ opensAtMin: 540, closesAtMin: 540, slotMin: 30 })).toEqual([]);
  });

  it("does not throw on non-finite hours", () => {
    expect(
      slotsForSalon({ opensAtMin: Number.NaN, closesAtMin: 1200, slotMin: 30 }),
    ).toEqual([]);
  });
});

describe("rangesOverlap", () => {
  it("treats intervals as half-open so back-to-back bookings do not collide", () => {
    // 10:00-11:00 and 11:00-12:00 must both be sellable.
    expect(rangesOverlap(600, 60, 660, 60)).toBe(false);
    expect(rangesOverlap(660, 60, 600, 60)).toBe(false);
  });

  it("detects every kind of genuine overlap", () => {
    expect(rangesOverlap(600, 60, 600, 60)).toBe(true); // identical
    expect(rangesOverlap(600, 60, 630, 60)).toBe(true); // later starts inside
    expect(rangesOverlap(630, 60, 600, 60)).toBe(true); // earlier ends inside
    expect(rangesOverlap(600, 180, 660, 30)).toBe(true); // fully contained
    expect(rangesOverlap(660, 30, 600, 180)).toBe(true); // fully containing
  });

  it("is symmetric for every pair on a realistic grid", () => {
    for (let a = 540; a < 1200; a += 30) {
      for (let b = 540; b < 1200; b += 30) {
        expect(rangesOverlap(a, 60, b, 90)).toBe(rangesOverlap(b, 90, a, 60));
      }
    }
  });

  it("reports no overlap for a zero-length range", () => {
    expect(rangesOverlap(600, 0, 600, 60)).toBe(false);
  });
});

describe("conflictsWithExisting", () => {
  const existing = [
    { id: "a", startMin: 600, durationMin: 60, status: "confirmed" },
    { id: "b", startMin: 780, durationMin: 30, status: "cancelled" },
    { id: "c", startMin: 900, durationMin: 90, status: "done" },
  ];

  it("finds a clash with a confirmed booking", () => {
    expect(conflictsWithExisting({ startMin: 630, durationMin: 30 }, existing)).toBe(true);
  });

  it("ignores cancelled bookings, so a cancelled slot is immediately reusable", () => {
    expect(conflictsWithExisting({ startMin: 780, durationMin: 30 }, existing)).toBe(false);
  });

  it("still blocks a completed booking — it did happen", () => {
    expect(conflictsWithExisting({ startMin: 930, durationMin: 30 }, existing)).toBe(true);
  });

  it("allows a free slot", () => {
    expect(conflictsWithExisting({ startMin: 660, durationMin: 60 }, existing)).toBe(false);
  });

  it("lets a booking being edited not conflict with itself", () => {
    // Extending a 10:00 booking from 60 to 90 minutes must not be reported as
    // a clash with the row it is editing.
    expect(
      conflictsWithExisting({ startMin: 600, durationMin: 90 }, existing, "a"),
    ).toBe(false);
  });

  it("still catches a clash with a different booking while editing", () => {
    expect(
      conflictsWithExisting({ startMin: 880, durationMin: 60 }, existing, "a"),
    ).toBe(true);
  });

  it("a long booking swallows the slots behind it", () => {
    const list = [{ id: "x", startMin: 840, durationMin: 90, status: "confirmed" }];
    // 14:00 + 90min blocks 14:30 and 15:00 but not 15:30.
    expect(conflictsWithExisting({ startMin: 870, durationMin: 30 }, list)).toBe(true);
    expect(conflictsWithExisting({ startMin: 900, durationMin: 30 }, list)).toBe(true);
    expect(conflictsWithExisting({ startMin: 930, durationMin: 30 }, list)).toBe(false);
  });

  it("reports no conflict against an empty day", () => {
    expect(conflictsWithExisting({ startMin: 600, durationMin: 60 }, [])).toBe(false);
  });
});

describe("todayInSalonTz", () => {
  it("returns the storage shape", () => {
    expect(todayInSalonTz()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("resolves the salons' own day, not the server's", () => {
    // 23:30 UTC on 6 September is already 7 September in Casablanca (UTC+1).
    // A server in UTC must agree with the salon about which day that is.
    expect(todayInSalonTz(new Date("2026-09-06T23:30:00Z"))).toBe("2026-09-07");
    expect(todayInSalonTz(new Date("2026-09-07T00:30:00Z"))).toBe("2026-09-07");
  });

  it("is a valid date string for every hour of a day", () => {
    for (let h = 0; h < 24; h += 1) {
      const value = todayInSalonTz(
        new Date(Date.UTC(2026, 8, 7, h, 30, 0)),
      );
      expect(isValidDateString(value)).toBe(true);
    }
  });

  it("falls back to now rather than throwing on an invalid Date", () => {
    expect(isValidDateString(todayInSalonTz(new Date("nonsense")))).toBe(true);
  });
});

describe("nowMinutesInSalonTz", () => {
  it("returns minutes inside the day", () => {
    const value = nowMinutesInSalonTz();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(MINUTES_IN_DAY);
  });

  it("reports the salon's clock, not UTC", () => {
    // 12:00 UTC is 13:00 in Casablanca during the +01:00 period.
    const value = nowMinutesInSalonTz(new Date("2026-09-07T12:00:00Z"));
    expect(value % 60).toBe(0);
    expect([12 * 60, 13 * 60]).toContain(value);
  });

  it("never returns 1440 for midnight", () => {
    expect(nowMinutesInSalonTz(new Date("2026-09-06T23:00:00Z"))).toBeLessThan(
      MINUTES_IN_DAY,
    );
  });

  it("does not throw on an invalid Date", () => {
    expect(() => nowMinutesInSalonTz(new Date("nonsense"))).not.toThrow();
  });
});

describe("formatLongDate", () => {
  it("renders French for the salon screens", () => {
    const value = formatLongDate("2026-09-07");
    expect(value).toContain("2026");
    expect(value.toLowerCase()).toContain("septembre");
  });

  it("does not shift the day, whatever the server timezone", () => {
    // Formatting through UTC is what keeps 2026-09-07 from rendering as the
    // 6th on a server west of Greenwich.
    expect(formatLongDate("2026-09-07")).toContain("7");
    expect(formatLongDate("2026-01-01")).toContain("1");
    expect(formatLongDate("2026-12-31")).toContain("31");
  });

  it("returns the input rather than throwing on a bad date", () => {
    expect(formatLongDate("not-a-date")).toBe("not-a-date");
    expect(() => formatLongDate("")).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";

import { getServicesForSalon, groupedServicesForSalon } from "@/lib/services-catalog";
import { isSlotOver, slotsForSalon } from "@/lib/time";
import { DURATION_OPTIONS, MAX_DURATION_MIN, MIN_DURATION_MIN } from "@/lib/validation";

/**
 * The static catalogue pre-fills the booking sheet. A service whose duration
 * is not one of the sheet's options would open with a blank duration field,
 * and one outside the API's bounds could never be booked at all — so the
 * catalogue is checked against both.
 */

const SLUGS = ["vip", "gold", "barber"] as const;

describe("service catalogue", () => {
  it.each(SLUGS)("%s: every duration is selectable in the booking sheet and bookable by the API", (slug) => {
    for (const entry of getServicesForSalon(slug)) {
      expect(DURATION_OPTIONS as readonly number[], entry.name).toContain(entry.durationMin);
      expect(entry.durationMin).toBeGreaterThanOrEqual(MIN_DURATION_MIN);
      expect(entry.durationMin).toBeLessThanOrEqual(MAX_DURATION_MIN);
    }
  });

  it.each(SLUGS)("%s: names are unique, non-blank and within the API's 120 characters", (slug) => {
    const names = getServicesForSalon(slug).map((e) => e.name);
    expect(new Set(names.map((n) => n.trim().toLowerCase())).size).toBe(names.length);
    for (const name of names) {
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(120);
    }
  });

  it.each(SLUGS)("%s: prices are whole, non-negative MAD amounts", (slug) => {
    for (const entry of getServicesForSalon(slug)) {
      expect(Number.isInteger(entry.price), entry.name).toBe(true);
      expect(entry.price).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(SLUGS)("%s: grouping keeps every service, once, in first-seen category order", (slug) => {
    const flat = getServicesForSalon(slug);
    const groups = groupedServicesForSalon(slug);
    expect(groups.flatMap((g) => g.items)).toEqual(
      [...flat].sort(
        (a, b) =>
          groups.findIndex((g) => g.category === a.category) -
          groups.findIndex((g) => g.category === b.category),
      ),
    );
    expect(new Set(groups.map((g) => g.category)).size).toBe(groups.length);
  });

  it("gives Gold only the hair, protein, colour and nail categories", () => {
    const categories = new Set(getServicesForSalon("gold").map((e) => e.category));
    expect([...categories].sort()).toEqual(
      ["Coloration & techniques", "Onglerie", "Soin Protéine", "Soins Cheveux"].sort(),
    );
  });

  it("falls back to the VIP catalogue for an unknown salon rather than an empty sheet", () => {
    expect(getServicesForSalon("unknown")).toEqual(getServicesForSalon("vip"));
  });
});

describe("isSlotOver — the one rule the grids, the sheet and the server share", () => {
  it("keeps the slot under way bookable and closes it exactly when it ends", () => {
    expect(isSlotOver(840, 30, 840)).toBe(false); // 14:00 at 14:00
    expect(isSlotOver(840, 30, 850)).toBe(false); // 14:00 at 14:10
    expect(isSlotOver(840, 30, 869)).toBe(false); // 14:00 at 14:29
    expect(isSlotOver(840, 30, 870)).toBe(true); // 14:00 at 14:30
    expect(isSlotOver(840, 30, 900)).toBe(true);
  });

  it("leaves at least one bookable slot until the last one ends, for every minute of the day", () => {
    const salon = { opensAtMin: 540, closesAtMin: 1380, slotMin: 30 };
    const slots = slotsForSalon(salon);
    for (let now = 0; now < 1440; now += 1) {
      const open = slots.filter((s) => !isSlotOver(s, salon.slotMin, now));
      if (now < salon.closesAtMin) {
        expect(open.length, `at minute ${now}`).toBeGreaterThan(0);
        // The first open slot is the one in progress (or the next to start).
        expect(open[0]! + salon.slotMin, `at minute ${now}`).toBeGreaterThan(now);
      } else {
        expect(open, `at minute ${now}`).toEqual([]);
      }
    }
  });
});

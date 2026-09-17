import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, it } from "vitest";

import { bookings, salons } from "@/db/schema";
import { isCheckViolation, isSlotConflictError, pgErrorCode } from "@/lib/db-errors";

import {
  db,
  describeIfDb,
  insertBookingRaw,
  makeSalon,
  moveBookingRaw,
  setBookingServiceRaw,
  setBookingStatusRaw,
} from "../helpers/db";
import { closeDb, findDoubleBookings, resetWithRealSalons } from "../helpers/fixtures";

/**
 * The guarantees that live in PostgreSQL itself, exercised with raw inserts
 * that bypass every line of application code. If one of these fails, no
 * amount of careful route handling can stop two agents selling the same
 * minutes — so these are tested first and most bluntly.
 */

const DAY = "2030-03-12";

async function expectConflict(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "the database accepted a double booking").not.toBeNull();
  expect(isSlotConflictError(error)).toBe(true);
}

async function expectCheckViolation(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "the database accepted an invalid row").not.toBeNull();
  expect(isCheckViolation(error)).toBe(true);
}

afterAll(closeDb);

describeIfDb("database: double-booking exclusion constraint", () => {
  let vipId: string;
  let goldId: string;

  beforeEach(async () => {
    const s = await resetWithRealSalons();
    vipId = s.vip.id;
    goldId = s.gold.id;
  });

  it("rejects the identical slot for the same service", async () => {
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" });
    await expectConflict(
      insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" }),
    );
  });

  it("rejects a partial overlap from either side for the same service", async () => {
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, durationMin: 60, service: "Coupe" });
    await expectConflict(
      insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 630, durationMin: 60, service: "Coupe" }),
    );
    await expectConflict(
      insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 570, durationMin: 60, service: "Coupe" }),
    );
  });

  it("rejects a short booking swallowed by a long one, and a long one swallowing a short one", async () => {
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 840, durationMin: 180, service: "Balayage" });
    await expectConflict(
      insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 900, durationMin: 30, service: "Balayage" }),
    );
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 660, durationMin: 30, service: "Brushing" });
    await expectConflict(
      insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, durationMin: 180, service: "Brushing" }),
    );
  });

  it("accepts back-to-back bookings of the same service", async () => {
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, durationMin: 30, service: "Coupe" });
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 630, durationMin: 30, service: "Coupe" });
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 570, durationMin: 30, service: "Coupe" });
    expect(await findDoubleBookings()).toEqual([]);
  });

  it("accepts different services at the same time in the same salon", async () => {
    for (const service of ["Coupe", "Manucure Simple", "Pédicure SPA", "Hammam VIP", "Brushing"]) {
      await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, durationMin: 60, service });
    }
    const rows = await db.select().from(bookings).where(eq(bookings.salonId, vipId));
    expect(rows).toHaveLength(5);
  });

  it("keeps salons independent: the same slot and service in another salon is fine", async () => {
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" });
    await insertBookingRaw({ salonId: goldId, bookingDate: DAY, startMin: 600, service: "Coupe" });
  });

  it("keeps days independent: the same slot and service on another day is fine", async () => {
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" });
    await insertBookingRaw({ salonId: vipId, bookingDate: "2030-03-13", startMin: 600, service: "Coupe" });
  });

  it("frees the slot as soon as a booking is cancelled", async () => {
    const first = await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" });
    await setBookingStatusRaw(first.id, "cancelled");
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" });
  });

  it("allows any number of cancelled rows on the same slot", async () => {
    for (let i = 0; i < 4; i += 1) {
      await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe", status: "cancelled" });
    }
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" });
  });

  it("still blocks a slot held by a booking marked done", async () => {
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe", status: "done" });
    await expectConflict(
      insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" }),
    );
  });

  it("refuses to revive a cancelled booking onto minutes someone else now holds", async () => {
    const old = await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe", status: "cancelled" });
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" });
    await expectConflict(setBookingStatusRaw(old.id, "confirmed"));
  });

  it("refuses to move a booking onto another booking of the same service", async () => {
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" });
    const other = await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 720, service: "Coupe" });
    await expectConflict(moveBookingRaw(other.id, 600));
  });

  it("refuses to change a booking's service into one already booked at that time", async () => {
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" });
    const other = await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Brushing" });
    await expectConflict(setBookingServiceRaw(other.id, "Coupe"));
  });

  it("treats service names that differ only by case or spaces as the same service", async () => {
    // Custom services are free text typed by staff. "Coupe enfant" and
    // "coupe enfant" are one chair; letting both through at 10:00 is a
    // double booking the grid's own conflict check already calls one.
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe enfant" });
    await expectConflict(
      insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "coupe enfant" }),
    );
    await expectConflict(
      insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 615, durationMin: 30, service: "COUPE ENFANT" }),
    );
    await expectConflict(
      insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: " Coupe enfant " }),
    );
  });

  it("reports the conflict with a SQLSTATE the application maps to 409", async () => {
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" });
    const error = await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" }).catch(
      (e: unknown) => e,
    );
    expect(["23505", "23P01"]).toContain(pgErrorCode(error));
  });

  it("serialises a burst of identical concurrent inserts down to exactly one winner", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 25 }, () =>
        insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" }),
      ),
    );
    const won = attempts.filter((a) => a.status === "fulfilled");
    const lost = attempts.filter((a) => a.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(24);
    for (const failure of lost) {
      expect(isSlotConflictError((failure as PromiseRejectedResult).reason)).toBe(true);
    }
  });

  it("serialises concurrent overlapping inserts so the survivors never overlap", async () => {
    const ranges = [
      [600, 90], [630, 60], [660, 30], [570, 60], [600, 30],
      [690, 60], [540, 120], [720, 30], [750, 30], [645, 15],
    ] as const;
    await Promise.allSettled(
      ranges.map(([startMin, durationMin]) =>
        insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin, durationMin, service: "Coupe" }),
      ),
    );
    expect(await findDoubleBookings()).toEqual([]);
    const survivors = await db.select().from(bookings);
    expect(survivors.length).toBeGreaterThanOrEqual(1);
  });
});

describeIfDb("database: row guards", () => {
  let vipId: string;

  beforeEach(async () => {
    const s = await resetWithRealSalons();
    vipId = s.vip.id;
  });

  it("rejects a booking that runs past midnight", async () => {
    await expectCheckViolation(
      insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 1380, durationMin: 120 }),
    );
  });

  it("accepts a booking that ends exactly at midnight", async () => {
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 1410, durationMin: 30 });
  });

  it("rejects start minutes outside the day", async () => {
    await expectCheckViolation(insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: -30 }));
    await expectCheckViolation(insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 1440 }));
  });

  it("rejects zero and negative durations", async () => {
    await expectCheckViolation(insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, durationMin: 0 }));
    await expectCheckViolation(insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, durationMin: -30 }));
  });

  it("rejects a blank client name or service", async () => {
    await expectCheckViolation(insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, clientName: "   " }));
    await expectCheckViolation(insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "  " }));
  });

  it("refuses to delete a salon that still has bookings", async () => {
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600 });
    const error = await db.delete(salons).where(eq(salons.id, vipId)).catch((e: unknown) => e);
    expect(pgErrorCode(error)).toBe("23503");
  });

  it("rejects salon hours that would break the grid", async () => {
    await expectCheckViolation(makeSalon({ opensAtMin: 1200, closesAtMin: 600 }));
    await expectCheckViolation(makeSalon({ slotMin: 0 }));
    await expectCheckViolation(makeSalon({ closesAtMin: 1500 }));
  });

  it("has the exclusion constraint installed with the expected shape", async () => {
    // The guarantee lives on booking_services, one row per service, not on
    // bookings itself — see db/schema.ts.
    const result = await db.execute(sql`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = 'booking_services_no_overlap' and contype = 'x'
    `);
    const def = ((result as unknown as { rows: { def: string }[] }).rows[0]?.def ?? "");
    expect(def).toContain("salon_id WITH =");
    expect(def).toContain("booking_date WITH =");
    expect(def).toContain("int4range(start_min, (start_min + duration_min)) WITH &&");
    expect(def).toContain("cancelled");
  });
});

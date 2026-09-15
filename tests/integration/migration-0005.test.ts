import { readFileSync } from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, it } from "vitest";

import { isSlotConflictError } from "@/lib/db-errors";

import { db, describeIfDb, insertBookingRaw } from "../helpers/db";
import { closeDb, resetWithRealSalons, rowsOf } from "../helpers/fixtures";

/**
 * drizzle/0005 replaces the double-booking constraint on a live production
 * table, through a migrator that — on Neon — runs each statement outside any
 * transaction. The one outcome that must be impossible is a table left with
 * no constraint at all, so this suite puts the database back in its 0004
 * shape, feeds the migration data it must refuse, and checks what is left.
 */

const MIGRATION = readFileSync(
  path.join(process.cwd(), "drizzle", "0005_service_case_insensitive.sql"),
  "utf8",
);

const DAY = "2030-05-20";

async function constraintDef(): Promise<string | null> {
  const result = await db.execute(sql`
    select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'bookings'::regclass and contype = 'x'
  `);
  const rows = rowsOf<{ def: string }>(result);
  expect(rows.length, "exactly one exclusion constraint").toBe(1);
  return rows[0]?.def ?? null;
}

async function indexNames(): Promise<string[]> {
  const result = await db.execute(sql`select indexname from pg_indexes where tablename = 'bookings' order by 1`);
  return rowsOf<{ indexname: string }>(result).map((r) => r.indexname);
}

/** Rebuilds the constraints exactly as 0004 left them. */
async function restore0004(): Promise<void> {
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;
      DROP INDEX IF EXISTS bookings_slot_unique;
      CREATE UNIQUE INDEX bookings_slot_unique ON bookings (salon_id, booking_date, service, start_min) WHERE (status <> 'cancelled');
      ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
        salon_id WITH =, booking_date WITH =, service WITH =,
        int4range(start_min, start_min + duration_min) WITH &&
      ) WHERE (status <> 'cancelled');
    END $$;
  `));
}

let vipId: string;

beforeEach(async () => {
  const salons = await resetWithRealSalons();
  vipId = salons.vip.id;
});

afterAll(async () => {
  // Leave the schema as the migrations define it for every other suite.
  await db.execute(sql`delete from bookings`);
  const def = await constraintDef();
  if (!def?.includes("lower")) {
    await db.execute(sql.raw(MIGRATION));
  }
  await closeDb();
});

describeIfDb("migration 0005: case-insensitive service constraint", () => {
  it("refuses atomically when live data already breaks the stricter rule, leaving the old constraint in place", async () => {
    await restore0004();
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe enfant" });
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "coupe enfant" });

    const error = await db.execute(sql.raw(MIGRATION)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error, "the migration accepted conflicting data").not.toBeNull();

    // Still protected by the 0004 definition, and nothing half-built left over.
    expect(await constraintDef()).toContain("service WITH =");
    expect(await indexNames()).not.toContain("bookings_slot_unique_ci");
    const exactDuplicate = await insertBookingRaw({
      salonId: vipId,
      bookingDate: DAY,
      startMin: 600,
      service: "Coupe enfant",
    }).catch((e: unknown) => e);
    expect(isSlotConflictError(exactDuplicate)).toBe(true);
  });

  it("applies once the conflict is resolved, and then refuses case variants", async () => {
    await restore0004();
    const first = await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe enfant" });
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "coupe enfant", status: "cancelled" });
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 660, service: "Brushing" });

    await db.execute(sql.raw(MIGRATION));

    expect(await constraintDef()).toContain("lower(btrim((service)::text))");
    const names = await indexNames();
    expect(names).toContain("bookings_slot_unique");
    expect(names).toContain("bookings_no_overlap");
    expect(names.filter((n) => n.endsWith("_ci"))).toEqual([]);

    const variant = await insertBookingRaw({
      salonId: vipId,
      bookingDate: DAY,
      startMin: 615,
      durationMin: 30,
      service: " COUPE ENFANT ",
    }).catch((e: unknown) => e);
    expect(isSlotConflictError(variant)).toBe(true);
    expect(first.service).toBe("Coupe enfant");
  });

  it("keeps every other guarantee: other services, other days, cancelled rows", async () => {
    await restore0004();
    await db.execute(sql.raw(MIGRATION));
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Coupe" });
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "Brushing" });
    await insertBookingRaw({ salonId: vipId, bookingDate: "2030-05-21", startMin: 600, service: "coupe" });
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 630, service: "COUPE" });
    await insertBookingRaw({ salonId: vipId, bookingDate: DAY, startMin: 600, service: "coupe", status: "cancelled" });
  });
});

import { sql } from "drizzle-orm";
import { describe } from "vitest";

import { db, resetDb } from "@/db";
import { bookings, salons, users } from "@/db/schema";

/**
 * Integration-test plumbing.
 *
 * These suites run against a real PostgreSQL because the two guarantees that
 * matter most — the exclusion constraint that makes double booking
 * impossible, and the CHECK constraints added in 0002 — live in the database
 * and cannot be exercised by a mock. A mock that returns whatever the test
 * expects would have passed happily against the very bug this audit found.
 */

export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

/** Every integration file opens with this so a machine with no DB still passes. */
export const describeIfDb = hasTestDatabase ? describe : describe.skip;

/** Empties the tables. Bookings first: they reference salons. */
export async function truncateAll(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE ${bookings}, ${salons}, ${users} RESTART IDENTITY CASCADE`,
  );
}

export type SalonSeed = {
  slug?: string;
  name?: string;
  sortOrder?: number;
  opensAtMin?: number;
  closesAtMin?: number;
  slotMin?: number;
};

let salonCounter = 0;

/** A salon with sane defaults; every field overridable per test. */
export async function makeSalon(seed: SalonSeed = {}) {
  salonCounter += 1;
  const rows = await db
    .insert(salons)
    .values({
      slug: seed.slug ?? `salon-${salonCounter}`,
      name: seed.name ?? `Salon ${salonCounter}`,
      sortOrder: seed.sortOrder ?? salonCounter,
      opensAtMin: seed.opensAtMin ?? 9 * 60,
      closesAtMin: seed.closesAtMin ?? 20 * 60,
      slotMin: seed.slotMin ?? 30,
    })
    .returning();
  return rows[0];
}

/** The three salons the real seed creates, in the real order. */
export async function makeStandardSalons() {
  return {
    vip: await makeSalon({ slug: "vip", name: "L'Atelier VIP", sortOrder: 0 }),
    gold: await makeSalon({ slug: "gold", name: "L'Atelier Gold", sortOrder: 1 }),
    barber: await makeSalon({
      slug: "barber",
      name: "L'Atelier Barber Shop & Spa",
      sortOrder: 2,
      closesAtMin: 21 * 60,
    }),
  };
}

export async function makeUser(
  username: "staff" | "owner",
  passwordHash: string,
) {
  const rows = await db
    .insert(users)
    .values({ username, role: username, passwordHash })
    .returning();
  return rows[0];
}

/** Raw insert that bypasses the application layer, to test the DB directly. */
export async function insertBookingRaw(values: {
  salonId: string;
  bookingDate?: string;
  startMin: number;
  durationMin?: number;
  status?: "confirmed" | "cancelled" | "done";
  clientName?: string;
  clientPhone?: string;
  service?: string;
}) {
  const rows = await db
    .insert(bookings)
    .values({
      salonId: values.salonId,
      clientName: values.clientName ?? "Client Test",
      clientPhone: values.clientPhone ?? "+212612345678",
      bookingDate: values.bookingDate ?? "2026-06-01",
      startMin: values.startMin,
      durationMin: values.durationMin ?? 30,
      service: values.service ?? "Coupe",
      status: values.status ?? "confirmed",
    })
    .returning();
  return rows[0];
}

export { db, resetDb };

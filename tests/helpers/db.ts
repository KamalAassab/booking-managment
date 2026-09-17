import { eq, sql } from "drizzle-orm";
import { describe } from "vitest";

import { db, resetDb } from "@/db";
import { bookingServices, bookings, salons, users } from "@/db/schema";

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
  // tests/setup.ts also loads .env.local, whose DATABASE_URL is a real
  // database. Wiping it because a suite forgot its describeIfDb guard would
  // be unrecoverable, so truncation refuses to run anywhere but the test DB.
  const url = process.env.DATABASE_URL;
  if (
    !process.env.TEST_DATABASE_URL ||
    (url !== process.env.TEST_DATABASE_URL && url !== process.env.NEON_HTTP_EMULATED_URL)
  ) {
    throw new Error("truncateAll() refused: DATABASE_URL is not the test database.");
  }
  await db.execute(
    sql`TRUNCATE TABLE ${bookingServices}, ${bookings}, ${salons}, ${users} RESTART IDENTITY CASCADE`,
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

/**
 * Raw insert that bypasses the application layer, to test the DB directly.
 *
 * Two plain inserts, not the app's atomic single-statement write: this
 * helper exists to poke the database's own constraints directly, one test at
 * a time, so the lack of a cross-statement transaction is not a concern here.
 */
export async function insertBookingRaw(values: {
  salonId: string;
  bookingDate?: string;
  startMin: number;
  durationMin?: number;
  status?: "confirmed" | "cancelled" | "done";
  clientName?: string;
  clientPhone?: string;
  service?: string;
  price?: number;
}) {
  const bookingDate = values.bookingDate ?? "2026-06-01";
  const durationMin = values.durationMin ?? 30;
  const status = values.status ?? "confirmed";
  const service = values.service ?? "Coupe";

  const rows = await db
    .insert(bookings)
    .values({
      salonId: values.salonId,
      clientName: values.clientName ?? "Client Test",
      clientPhone: values.clientPhone ?? "+212612345678",
      bookingDate,
      startMin: values.startMin,
      durationMin,
      status,
    })
    .returning();
  const booking = rows[0];

  await db.insert(bookingServices).values({
    bookingId: booking.id,
    salonId: values.salonId,
    bookingDate,
    status,
    service,
    startMin: values.startMin,
    durationMin,
    price: values.price ?? 0,
    sortOrder: 0,
  });

  return booking;
}

/**
 * Mirrors what cancelBooking/updateBooking do to a booking's status, but as
 * two plain statements rather than the app's one atomic write — for testing
 * the raw constraint's reaction, the same way insertBookingRaw does.
 */
export async function setBookingStatusRaw(
  id: string,
  status: "confirmed" | "cancelled" | "done",
): Promise<void> {
  await db.update(bookings).set({ status }).where(eq(bookings.id, id));
  await db.update(bookingServices).set({ status }).where(eq(bookingServices.bookingId, id));
}

/** Mirrors moving a booking's start time: every service's own slice shifts with it. */
export async function moveBookingRaw(id: string, nextStartMin: number): Promise<void> {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
  const delta = nextStartMin - booking.startMin;
  await db.update(bookings).set({ startMin: nextStartMin }).where(eq(bookings.id, id));
  const lines = await db.select().from(bookingServices).where(eq(bookingServices.bookingId, id));
  for (const line of lines) {
    await db
      .update(bookingServices)
      .set({ startMin: line.startMin + delta })
      .where(eq(bookingServices.id, line.id));
  }
}

/** Mirrors renaming the (single) service on a booking. */
export async function setBookingServiceRaw(id: string, service: string): Promise<void> {
  await db.update(bookingServices).set({ service }).where(eq(bookingServices.bookingId, id));
}

export { db, resetDb };

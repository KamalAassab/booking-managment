import { sql } from "drizzle-orm";

import { db, getDb, resetDb } from "@/db";
import type { Salon } from "@/db/schema";
import { addDays, todayInSalonTz } from "@/lib/time";

import { hasTestDatabase, makeSalon, truncateAll } from "./db";

/**
 * Shared fixtures for the database-backed suites: the salons exactly as the
 * real seed creates them, a valid booking payload to vary from, and the one
 * invariant every scenario ends by checking — no two live bookings of the
 * same service overlap in the same salon on the same day.
 */

/** Hours from scripts/seed.ts, the values production actually runs with. */
export const REAL_SALONS = [
  { slug: "vip", name: "L'Atelier VIP", sortOrder: 0, opensAtMin: 600, closesAtMin: 1320, slotMin: 30 },
  { slug: "gold", name: "L'Atelier Gold", sortOrder: 1, opensAtMin: 540, closesAtMin: 1380, slotMin: 30 },
  { slug: "barber", name: "L'Atelier Silver", sortOrder: 2, opensAtMin: 540, closesAtMin: 1380, slotMin: 30 },
] as const;

export type SalonSlug = (typeof REAL_SALONS)[number]["slug"];

export async function resetWithRealSalons(): Promise<Record<SalonSlug, Salon>> {
  await truncateAll();
  const out = {} as Record<SalonSlug, Salon>;
  for (const seed of REAL_SALONS) {
    out[seed.slug] = await makeSalon({ ...seed });
  }
  return out;
}

/**
 * A day comfortably in the future. Two days is the minimum used anywhere, so
 * a suite that happens to run across midnight in Casablanca cannot turn a
 * "future" booking into a past one halfway through.
 */
export function futureDate(daysAhead = 7): string {
  return addDays(todayInSalonTz(), daysAhead);
}

let clientCounter = 0;

/** A distinct, valid Moroccan mobile number per call: 06 1x xx xx xx. */
export function nextPhone(): string {
  clientCounter += 1;
  return `061${String(clientCounter % 10_000_000).padStart(7, "0")}`;
}

export function bookingInput(overrides: Record<string, unknown> = {}) {
  const phone = nextPhone();
  return {
    salonSlug: "vip",
    clientName: `Client ${phone.slice(-4)}`,
    clientPhone: phone,
    bookingDate: futureDate(),
    startMin: 600,
    durationMin: 30,
    service: "Manucure Simple",
    notes: "",
    channel: "front_desk",
    ...overrides,
  };
}

/** Rows out of `db.execute`, whichever driver produced them. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

export type OverlapRow = {
  a_id: string;
  b_id: string;
  a_service: string;
  b_service: string;
  day: string;
  a_start: number;
  a_duration: number;
  b_start: number;
  b_duration: number;
};

/**
 * Every pair of live bookings that the business would call a double booking:
 * same salon, same day, the same service (ignoring case and surrounding
 * spaces, as staff type it), and intersecting [start, end) minutes.
 */
export async function findDoubleBookings(): Promise<OverlapRow[]> {
  const result = await db.execute(sql`
    select a.id as a_id, b.id as b_id, a.service as a_service, b.service as b_service,
           a.booking_date::text as day,
           a.start_min as a_start, a.duration_min as a_duration,
           b.start_min as b_start, b.duration_min as b_duration
      from bookings a
      join bookings b
        on a.salon_id = b.salon_id
       and a.booking_date = b.booking_date
       and lower(btrim(a.service)) = lower(btrim(b.service))
       and a.id < b.id
     where a.status <> 'cancelled'
       and b.status <> 'cancelled'
       and int4range(a.start_min, a.start_min + a.duration_min)
        && int4range(b.start_min, b.start_min + b.duration_min)
  `);
  return rowsOf<OverlapRow>(result);
}

export async function countBookings(): Promise<number> {
  const result = await db.execute(sql`select count(*)::int as n from bookings`);
  return rowsOf<{ n: number }>(result)[0]?.n ?? 0;
}

/** Closes the pool so a suite's worker exits promptly. */
export async function closeDb(): Promise<void> {
  if (!hasTestDatabase) return;
  const client = (getDb() as unknown as { $client?: { end?: () => Promise<void> } })
    .$client;
  await client?.end?.();
  resetDb();
}

/** mulberry32 — a tiny seeded PRNG, so a failing random run can be replayed. */
export function prng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (p: number) => next() < p,
  };
}

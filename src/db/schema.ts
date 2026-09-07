import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["staff", "owner"]);
export const bookingStatus = pgEnum("booking_status", [
  "confirmed",
  "cancelled",
  "done",
]);
export const bookingChannel = pgEnum("booking_channel", [
  "call_center",
  "front_desk",
]);

/**
 * Accounts. Deliberately tiny: one shared `staff` account used by all four
 * call-centre agents and all three front-desk people, plus one `owner`
 * account. See PROJECT_BRIEF.md §3 — bookings are fully anonymous, so there
 * is no per-user attribution anywhere in this schema.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 32 }).notNull().unique(),
  role: userRole("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The three physical salons. Opening hours and slot length are per salon so
 * the owner can adjust them later without a code change.
 */
export const salons = pgTable("salons", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 24 }).notNull().unique(),
  name: varchar("name", { length: 80 }).notNull(),
  sortOrder: smallint("sort_order").notNull().default(0),
  /** Minutes from midnight, salon-local (Africa/Casablanca). 9:00 => 540. */
  opensAtMin: integer("opens_at_min").notNull().default(9 * 60),
  /** Exclusive end of the last bookable slot. 20:00 => 1200. */
  closesAtMin: integer("closes_at_min").notNull().default(20 * 60),
  /** Grid granularity in minutes. */
  slotMin: integer("slot_min").notNull().default(30),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Reservations.
 *
 * Overlap prevention is enforced in the database, not in application code, so
 * two devices sharing the same account cannot both win the same slot (brief
 * §3, "zero-delay double-booking prevention"). The constraint itself is a
 * GiST exclusion constraint added in the migration — Drizzle cannot express
 * `EXCLUDE USING gist` yet, so see drizzle/0001_no_overlap.sql. It rejects any
 * two non-cancelled bookings in the same salon, on the same day, whose
 * [start, start + duration) minute ranges intersect.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "restrict" }),
    clientName: varchar("client_name", { length: 120 }).notNull(),
    /** E.164, normalised on write (e.g. +2126...). Needed for the wa.me link. */
    clientPhone: varchar("client_phone", { length: 20 }).notNull(),
    /** Salon-local calendar day, stored as YYYY-MM-DD with no timezone maths. */
    bookingDate: date("booking_date").notNull(),
    /** Minutes from midnight, salon-local. 14:30 => 870. */
    startMin: integer("start_min").notNull(),
    durationMin: integer("duration_min").notNull().default(30),
    service: varchar("service", { length: 120 }).notNull(),
    notes: text("notes"),
    status: bookingStatus("status").notNull().default("confirmed"),
    /** Intake channel, not a person — kept anonymous per brief §3. */
    channel: bookingChannel("channel").notNull().default("front_desk"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Fast path for the calendar screen's only query shape.
    index("bookings_salon_date_idx").on(t.salonId, t.bookingDate, t.startMin),
    // Drives the live-update watermark without a table scan.
    index("bookings_updated_at_idx").on(t.updatedAt),
    // Redundant with the exclusion constraint for equal start times, but kept
    // as a cheap second line of defence and a clearer error for the common
    // "two agents picked the same slot" collision.
    uniqueIndex("bookings_slot_unique")
      .on(t.salonId, t.bookingDate, t.startMin)
      .where(sql`status <> 'cancelled'`),
    check("bookings_start_min_range", sql`${t.startMin} BETWEEN 0 AND 1439`),
    check("bookings_duration_positive", sql`${t.durationMin} > 0`),
  ],
);

export type Salon = typeof salons.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type User = typeof users.$inferSelect;

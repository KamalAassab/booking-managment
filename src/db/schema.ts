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
export const salons = pgTable(
  "salons",
  {
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
  },
  (t) => [
    // Opening hours are the one thing the owner may eventually edit by hand.
    // A slot length of zero would make the grid generator loop forever and a
    // closing time before opening would render an empty day with no
    // explanation, so both are refused at the storage layer.
    check(
      "salons_hours_ordered",
      sql`${t.opensAtMin} >= 0 AND ${t.closesAtMin} <= 1440 AND ${t.opensAtMin} < ${t.closesAtMin}`,
    ),
    check("salons_slot_positive", sql`${t.slotMin} > 0 AND ${t.slotMin} <= 480`),
  ],
);

/**
 * Reservations. One row per appointment; the services it covers live in
 * `bookingServices` below. `durationMin` here is the sum of those services'
 * own durations — the whole visit's block on the calendar — kept in sync by
 * application code because every write to a booking rewrites its services in
 * the same statement (see lib/bookings.ts).
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
    /** Sum of this booking's services' durations. */
    durationMin: integer("duration_min").notNull().default(30),
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
    check("bookings_start_min_range", sql`${t.startMin} BETWEEN 0 AND 1439`),
    check("bookings_duration_positive", sql`${t.durationMin} > 0`),
    // A booking must end on the day it starts — mirrors the same rule on
    // each of its services (bookings_services_within_day).
    check(
      "bookings_within_day",
      sql`${t.startMin} + ${t.durationMin} <= 1440`,
    ),
    check("bookings_client_name_present", sql`length(btrim(${t.clientName})) > 0`),
  ],
);

export type Salon = typeof salons.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type User = typeof users.$inferSelect;

/**
 * One line item of a booking: a single service, with its own slice of the
 * visit's time and its own price. A booking with three services has three
 * rows here, back to back, in `sortOrder`.
 *
 * Overlap prevention is enforced in the database, not in application code
 * (brief §3, "zero-delay double-booking prevention"), and it is *per
 * service*: a service name is a stand-in for the one chair/station that does
 * it, so two different services may run at the same time in the same salon,
 * but the same service cannot be double-booked. The constraint itself is a
 * GiST exclusion constraint added in the migrations — Drizzle cannot express
 * `EXCLUDE USING gist` yet, so see drizzle/0007_booking_services.sql. It
 * rejects any two non-cancelled service rows in the same salon, on the same
 * day, for the same service (compared ignoring case and surrounding spaces),
 * whose [start, start + duration) minute ranges intersect.
 *
 * `salonId`, `bookingDate` and `status` are copies of the parent booking's
 * own columns, not a separate source of truth: the exclusion constraint above
 * needs them on this table to compare rows without a join, and every write
 * that touches a booking's services rewrites all of them in the same
 * statement as the parent row (see lib/bookings.ts), so the two can never
 * drift apart.
 */
export const bookingServices = pgTable(
  "booking_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "restrict" }),
    bookingDate: date("booking_date").notNull(),
    status: bookingStatus("status").notNull().default("confirmed"),
    service: varchar("service", { length: 120 }).notNull(),
    /** Minutes from midnight, salon-local — this service's own slice. */
    startMin: integer("start_min").notNull(),
    durationMin: integer("duration_min").notNull(),
    /** MAD, this service's own price — the booking's total is their sum. */
    price: integer("price").notNull().default(0),
    /** Order the services run in, and the order they are shown in. */
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("booking_services_booking_idx").on(t.bookingId),
    // Redundant with the exclusion constraint for equal start times, but kept
    // as a cheap second line of defence and a clearer error for the common
    // "two agents picked the same slot" collision.
    uniqueIndex("booking_services_slot_unique")
      .on(t.salonId, t.bookingDate, sql`lower(btrim(${t.service}))`, t.startMin)
      .where(sql`status <> 'cancelled'`),
    check("booking_services_start_min_range", sql`${t.startMin} BETWEEN 0 AND 1439`),
    check("booking_services_duration_positive", sql`${t.durationMin} > 0`),
    // A service must end on the day it starts, for the same reason as
    // bookings_within_day: the exclusion constraint below compares ranges
    // only within the same booking_date.
    check(
      "booking_services_within_day",
      sql`${t.startMin} + ${t.durationMin} <= 1440`,
    ),
    check("booking_services_price_non_negative", sql`${t.price} >= 0`),
    check("booking_services_service_present", sql`length(btrim(${t.service})) > 0`),
  ],
);

export type BookingServiceRow = typeof bookingServices.$inferSelect;
export type NewBookingServiceRow = typeof bookingServices.$inferInsert;

/**
 * Per-salon service catalogue.
 *
 * Created from the hardcoded list in lib/services-catalog.ts on first seed;
 * the owner can then edit prices / names / durations without a code deploy.
 * The booking sheet reads from this table when available, falling back to
 * the static catalog if the table is empty (ConfigError / missing table).
 */
export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 120 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    durationMin: integer("duration_min").notNull().default(30),
    price: integer("price").notNull().default(0),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("services_salon_sort_idx").on(t.salonId, t.sortOrder),
    check("services_duration_positive", sql`${t.durationMin} > 0`),
    check("services_price_non_negative", sql`${t.price} >= 0`),
  ],
);

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;

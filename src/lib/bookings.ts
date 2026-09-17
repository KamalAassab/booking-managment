import "server-only";

import { and, asc, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { bookingServices, bookings, salons, type Booking, type Salon } from "@/db/schema";
import {
  isCheckViolation,
  isSlotConflictError,
  isTransientWriteError,
  isUnstorableTextError,
} from "./db-errors";
import { normalizePhone } from "./phone";
import {
  MINUTES_IN_DAY,
  isSlotOver,
  isValidDateString,
  minutesToLabel,
  nowMinutesInSalonTz,
  todayInSalonTz,
} from "./time";
import { toBookingDTO, type BookingDTO } from "./types";
import type {
  CreateBookingInput,
  ServiceLineInput,
  UpdateBookingInput,
} from "./validation";
import { totalDuration } from "./validation";

export class SlotTakenError extends Error {
  constructor(message = "Ce créneau vient d'être réservé sur un autre poste.") {
    super(message);
    this.name = "SlotTakenError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** A booking's services, one line per service, in run order. */
export type ServiceLine = {
  service: string;
  startMin: number;
  durationMin: number;
  price: number;
  sortOrder: number;
};

/**
 * A booking's own columns, flattened together with its services — what
 * `updateBooking` and `cancelBooking` return, matching REST PATCH/DELETE
 * semantics of "the resource, as it now stands." `createBooking` returns a
 * differently-shaped, nested bag instead (`{ booking, services, salon }`):
 * it is also handing back the salon it looked up, which does not belong
 * inside "the booking," so nesting is what keeps that one honest.
 */
export type BookingResult = Booking & { services: ServiceLine[] };

/**
 * The camelCase columns every query below returns, spelled out once.
 *
 * `booking_date` is cast to text: raw SQL bypasses Drizzle's own column
 * mapping (which normally turns a driver's `date` value — a JS `Date` on
 * some drivers, a plain string on others — back into the "YYYY-MM-DD" string
 * every date helper in this app expects). The cast makes the driver return a
 * plain string unconditionally, so there is nothing to disagree about.
 */
const BOOKING_COLUMNS_SQL = sql`
  nb."id" AS "id",
  nb."salon_id" AS "salonId",
  nb."client_name" AS "clientName",
  nb."client_phone" AS "clientPhone",
  nb."booking_date"::text AS "bookingDate",
  nb."start_min" AS "startMin",
  nb."duration_min" AS "durationMin",
  nb."notes" AS "notes",
  nb."status" AS "status",
  nb."channel" AS "channel",
  nb."created_at" AS "createdAt",
  nb."updated_at" AS "updatedAt"
`;

/** A service line, as one row of a `VALUES (...)` list, typed explicitly. */
function serviceValueRows(lines: readonly ServiceLine[]): SQL {
  return sql.join(
    lines.map(
      (l) =>
        sql`(${l.service}::varchar, ${l.startMin}::integer, ${l.durationMin}::integer, ${l.price}::integer, ${l.sortOrder}::smallint)`,
    ),
    sql`, `,
  );
}

/**
 * Every service back to back from `startMin`, in the order given — what
 * "an appointment for these services, starting at 14:00" means physically:
 * one chair at a time, never two at once for the same client.
 */
function computeServiceLines(
  startMin: number,
  services: readonly ServiceLineInput[],
): ServiceLine[] {
  let cursor = startMin;
  return services.map((s, index) => {
    const line: ServiceLine = {
      service: s.service,
      startMin: cursor,
      durationMin: s.durationMin,
      price: s.price,
      sortOrder: index,
    };
    cursor += s.durationMin;
    return line;
  });
}

export async function listSalons(): Promise<Salon[]> {
  return db.select().from(salons).orderBy(asc(salons.sortOrder), asc(salons.name));
}

export async function getSalonBySlug(slug: string): Promise<Salon | null> {
  if (typeof slug !== "string" || !slug) return null;
  const rows = await db.select().from(salons).where(eq(salons.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getBookingById(id: string): Promise<Booking | null> {
  const rows = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, id))
    .limit(1);
  return rows[0] ?? null;
}

const SERVICE_LINE_COLUMNS = {
  service: bookingServices.service,
  startMin: bookingServices.startMin,
  durationMin: bookingServices.durationMin,
  price: bookingServices.price,
  sortOrder: bookingServices.sortOrder,
};

/** A booking's own services, in run order — the source of truth for an edit that leaves them alone. */
export async function getServicesForBooking(bookingId: string): Promise<ServiceLine[]> {
  return db
    .select(SERVICE_LINE_COLUMNS)
    .from(bookingServices)
    .where(eq(bookingServices.bookingId, bookingId))
    .orderBy(asc(bookingServices.sortOrder));
}

/** Every service for a batch of bookings, grouped by booking id, in run order. */
export async function loadServicesFor(
  bookingIds: readonly string[],
): Promise<Map<string, ServiceLine[]>> {
  const map = new Map<string, ServiceLine[]>();
  if (bookingIds.length === 0) return map;
  const rows = await db
    .select({ bookingId: bookingServices.bookingId, ...SERVICE_LINE_COLUMNS })
    .from(bookingServices)
    .where(inArray(bookingServices.bookingId, bookingIds))
    .orderBy(asc(bookingServices.bookingId), asc(bookingServices.sortOrder));
  for (const { bookingId, ...line } of rows) {
    const list = map.get(bookingId);
    if (list) list.push(line);
    else map.set(bookingId, [line]);
  }
  return map;
}

/** A row plus its services, for one call site that already has the row. */
export async function attachServices(row: Booking): Promise<BookingResult> {
  const services = await getServicesForBooking(row.id);
  return { ...row, services };
}

/** A batch of rows plus their services, in one extra query rather than one per row. */
export async function attachServicesToAll(
  rows: readonly Booking[],
): Promise<BookingResult[]> {
  const byBooking = await loadServicesFor(rows.map((r) => r.id));
  return rows.map((row) => ({ ...row, services: byBooking.get(row.id) ?? [] }));
}

export async function listBookings(
  salonId: string,
  date: string,
): Promise<Booking[]> {
  return db
    .select()
    .from(bookings)
    .where(and(eq(bookings.salonId, salonId), eq(bookings.bookingDate, date)))
    .orderBy(asc(bookings.startMin), asc(bookings.createdAt));
}

export async function listBookingsForSalons(
  salonIds: string[],
  date: string,
): Promise<Booking[]> {
  if (salonIds.length === 0) return [];
  return db
    .select()
    .from(bookings)
    .where(
      and(inArray(bookings.salonId, salonIds), eq(bookings.bookingDate, date)),
    )
    .orderBy(asc(bookings.startMin), asc(bookings.createdAt));
}

/**
 * A month's worth of bookings for one salon, for the calendar grid's day
 * tags. Cancelled rows are excluded here rather than in the caller — a
 * cancelled slot is free again, and the grid has no use for it.
 */
export async function listBookingsInRange(
  salonId: string,
  from: string,
  to: string,
): Promise<Booking[]> {
  return db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.salonId, salonId),
        gte(bookings.bookingDate, from),
        lte(bookings.bookingDate, to),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(bookings.bookingDate), asc(bookings.startMin));
}

/**
 * A cheap change-detection watermark for the live-update poll: the row count
 * plus a digest of every row version in the day.
 *
 * `xmin` is the id of the transaction that wrote a row version, so it moves
 * on every insert and every update, whatever its timestamp says. This used to
 * be max(updated_at) plus a count, which is blind to any write whose
 * timestamp is not the newest by the time it commits — and with several
 * agents saving at once that is ordinary: a request stamps its row, waits a
 * few milliseconds on the network or on another agent's conflicting write,
 * and commits after a later one a screen has already seen. That screen then
 * stayed stale until something else changed. A server clock a little behind
 * the database's did the same to every edit.
 *
 * This is the query every open calendar runs about once a second, so it stays
 * tiny: one salon's day is a few dozen rows through bookings_salon_date_idx,
 * and the answer is one short string however many bookings the day holds.
 * It watches only `bookings`: a booking's services always change in the same
 * statement as the booking row itself, so the booking's own `xmin` already
 * moves whenever its services do.
 */
export async function bookingsWatermark(
  salonIds: string[],
  date: string,
): Promise<string> {
  return bookingsRangeWatermark(salonIds, date, date);
}

/**
 * The same change token over a span of days — the week and month views show
 * a whole month's bookings, and a booking made on any of those days must
 * reach every screen, not only the ones that happen to have that day selected.
 */
export async function bookingsRangeWatermark(
  salonIds: string[],
  from: string,
  to: string,
): Promise<string> {
  if (salonIds.length === 0) return "0:";
  const rows = await db
    .select({
      count: sql<number>`count(*)::int`,
      digest: sql<string | null>`md5(string_agg(${bookings.id}::text || '.' || ${bookings}.xmin::text, ',' order by ${bookings.id}))`,
    })
    .from(bookings)
    .where(
      and(
        inArray(bookings.salonId, salonIds),
        gte(bookings.bookingDate, from),
        lte(bookings.bookingDate, to),
      ),
    );
  const row = rows[0];
  return `${row?.count ?? 0}:${row?.digest ?? ""}`;
}

/**
 * The salon is open, the booking fits inside opening hours, and it starts on
 * the grid. Checked here rather than only in the browser because the API is
 * reachable directly and a booking placed off-grid is unreachable in the UI
 * that has to service it.
 */
function assertWithinOpeningHours(
  salon: Salon,
  startMin: number,
  durationMin: number,
): void {
  if (!Number.isInteger(startMin) || !Number.isInteger(durationMin)) {
    throw new ValidationError("Heure ou durée invalide.");
  }
  if (durationMin <= 0) {
    throw new ValidationError("La durée doit être positive.");
  }
  // Mirrors the bookings_within_day CHECK. Caught here so the agent gets a
  // sentence in French instead of a 500 from a constraint violation.
  if (startMin + durationMin > MINUTES_IN_DAY) {
    throw new ValidationError(
      "Un rendez-vous ne peut pas se prolonger après minuit.",
    );
  }
  if (startMin < salon.opensAtMin) {
    throw new ValidationError(
      `${salon.name} ouvre à ${minutesToLabel(salon.opensAtMin)}.`,
    );
  }
  if (startMin + durationMin > salon.closesAtMin) {
    throw new ValidationError(
      `Ce rendez-vous dépasse l'heure de fermeture (${minutesToLabel(salon.closesAtMin)}).`,
    );
  }
  // A salon row with slot_min <= 0 cannot exist any more (salons_slot_positive),
  // but a modulo by zero here would yield NaN and reject every booking with a
  // misleading message, so the guard stays.
  if (salon.slotMin > 0 && (startMin - salon.opensAtMin) % salon.slotMin !== 0) {
    throw new ValidationError("Heure de début hors grille horaire.");
  }
}

/** Turns a driver error into the right domain error, or rethrows it. */
function translateWriteError(error: unknown): never {
  if (isSlotConflictError(error)) throw new SlotTakenError();
  if (isCheckViolation(error)) {
    // A CHECK firing means our own validation let something through. The
    // agent still gets a usable sentence rather than a 500.
    throw new ValidationError(
      "Ce rendez-vous ne respecte pas les règles du planning.",
    );
  }
  if (isUnstorableTextError(error)) {
    throw new ValidationError("La saisie contient un caractère invalide.");
  }
  throw error;
}

const WRITE_ATTEMPTS = 3;

/**
 * Runs one booking write, retrying the failures that mean "try again".
 *
 * Two agents' writes meeting inside the exclusion constraint can, rarely,
 * each wait on the other; PostgreSQL then aborts one of them with a deadlock
 * error. Nothing was stored, so the write is simply repeated — by then the
 * other agent's booking has committed, and the retry either succeeds or
 * reports the slot as taken. Only if the database keeps refusing is the
 * collision reported as one, which is what it is.
 */
async function writeBooking<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      if (!isTransientWriteError(error)) translateWriteError(error);
      if (attempt >= WRITE_ATTEMPTS) throw new SlotTakenError();
      // Jittered, so two retrying agents do not meet again in lockstep.
      await new Promise((resolve) =>
        setTimeout(resolve, 5 + Math.random() * 20 * attempt),
      );
    }
  }
}

type RawBookingRow = BookingResult;

/** createBooking's own nested shape — see the note on BookingResult. */
function toNested(row: RawBookingRow): { booking: Booking; services: ServiceLine[] } {
  const { services, ...booking } = row;
  return { booking, services };
}

/** The JSON aggregate every write below returns for a booking's services. */
const SERVICES_JSON_SQL = sql`
  coalesce(
    json_agg(
      json_build_object(
        'service', ns."service",
        'startMin', ns."start_min",
        'durationMin', ns."duration_min",
        'price', ns."price",
        'sortOrder', ns."sort_order"
      )
      ORDER BY ns."sort_order"
    ),
    '[]'::json
  )
`;

export async function createBooking(
  input: CreateBookingInput,
): Promise<{ booking: Booking; services: ServiceLine[]; salon: Salon }> {
  const salon = await getSalonBySlug(input.salonSlug);
  if (!salon) throw new ValidationError("Salon introuvable.");

  const phone = normalizePhone(input.clientPhone);
  if (!phone.ok) throw new ValidationError(phone.error);

  const clientName = input.clientName.trim();
  const services = input.services.map((s) => ({ ...s, service: s.service.trim() }));
  if (!clientName) throw new ValidationError("Nom du client requis.");
  if (services.some((s) => !s.service)) throw new ValidationError("Service requis.");
  if (!isValidDateString(input.bookingDate)) {
    throw new ValidationError("Date invalide.");
  }

  const today = todayInSalonTz();
  if (input.bookingDate < today) {
    throw new ValidationError("Impossible de réserver une date passée.");
  }
  if (
    input.bookingDate === today &&
    isSlotOver(input.startMin, salon.slotMin, nowMinutesInSalonTz())
  ) {
    throw new ValidationError("Ce créneau est déjà passé.");
  }

  const duration = totalDuration(services);
  assertWithinOpeningHours(salon, input.startMin, duration);
  const lines = computeServiceLines(input.startMin, services);

  const row = await writeBooking(async () => {
    // One statement, atomic by construction: the booking row and every one
    // of its services are written together, so there is never a moment
    // where a booking exists with no services, or with the wrong ones — and
    // no cross-statement transaction is needed (see db/index.ts: the Neon
    // HTTP driver, used in production, cannot do one).
    const result = await db.execute<RawBookingRow>(sql`
      WITH new_booking AS (
        INSERT INTO "bookings"
          ("salon_id", "client_name", "client_phone", "booking_date", "start_min", "duration_min", "notes", "status", "channel")
        VALUES
          (${salon.id}, ${clientName}, ${phone.e164}, ${input.bookingDate}, ${input.startMin}, ${duration},
           ${input.notes?.trim() ? input.notes.trim() : null}, 'confirmed', ${input.channel})
        RETURNING *
      ),
      new_services AS (
        INSERT INTO "booking_services"
          ("booking_id", "salon_id", "booking_date", "status", "service", "start_min", "duration_min", "price", "sort_order")
        SELECT nb."id", nb."salon_id", nb."booking_date", nb."status", v.service, v.start_min, v.duration_min, v.price, v.sort_order
        FROM new_booking nb, (VALUES ${serviceValueRows(lines)}) AS v(service, start_min, duration_min, price, sort_order)
        RETURNING *
      )
      SELECT
        ${BOOKING_COLUMNS_SQL},
        (SELECT ${SERVICES_JSON_SQL} FROM new_services ns) AS "services"
      FROM new_booking nb
    `);
    const first = result.rows[0];
    if (!first) throw new Error("Insert returned no row.");
    return first;
  });

  return { ...toNested(row), salon };
}

export async function updateBooking(
  id: string,
  input: UpdateBookingInput,
): Promise<BookingResult | null> {
  const current = await getBookingById(id);
  if (!current) return null;

  const patch: Partial<{
    clientName: string;
    clientPhone: string;
    bookingDate: string;
    startMin: number;
    notes: string | null;
    status: Booking["status"];
  }> = {};

  if (input.clientName !== undefined) {
    const name = input.clientName.trim();
    if (!name) throw new ValidationError("Nom du client requis.");
    patch.clientName = name;
  }
  if (input.clientPhone !== undefined) {
    const phone = normalizePhone(input.clientPhone);
    if (!phone.ok) throw new ValidationError(phone.error);
    patch.clientPhone = phone.e164;
  }
  if (input.bookingDate !== undefined) {
    if (!isValidDateString(input.bookingDate)) {
      throw new ValidationError("Date invalide.");
    }
    patch.bookingDate = input.bookingDate;
  }
  if (input.startMin !== undefined) patch.startMin = input.startMin;
  const inputServices = input.services?.map((s) => ({ ...s, service: s.service.trim() }));
  if (inputServices?.some((s) => !s.service)) throw new ValidationError("Service requis.");
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.status !== undefined) patch.status = input.status;

  const currentServices = await getServicesForBooking(id);

  if (Object.keys(patch).length === 0 && inputServices === undefined) {
    // Nothing to change. Returning early avoids bumping updated_at, which
    // would wake every open calendar for a write that changed nothing.
    return { ...current, services: currentServices };
  }

  const nextStatus = patch.status ?? current.status;
  const nextStart = patch.startMin ?? current.startMin;
  const nextServiceInputs: ServiceLineInput[] =
    inputServices ??
    currentServices.map((s) => ({ service: s.service, durationMin: s.durationMin, price: s.price }));
  const nextDuration = totalDuration(nextServiceInputs);

  // Opening hours are re-checked whenever the booking moves in time or its
  // services change (either can change how long it runs), and also whenever
  // a cancelled booking is being revived: the row may have been cancelled
  // precisely because the salon's hours changed underneath it.
  const movingInTime =
    input.startMin !== undefined ||
    input.services !== undefined ||
    input.bookingDate !== undefined;
  const reviving = current.status === "cancelled" && nextStatus !== "cancelled";

  if (movingInTime || reviving) {
    const salonRows = await db
      .select()
      .from(salons)
      .where(eq(salons.id, current.salonId))
      .limit(1);
    const salon = salonRows[0];
    // A booking whose salon has vanished is corrupt data, not a validation
    // problem. The previous version skipped the check silently, which let a
    // booking be moved anywhere at all.
    if (!salon) {
      throw new NotFoundError("Le salon de ce rendez-vous est introuvable.");
    }
    assertWithinOpeningHours(salon, nextStart, nextDuration);
  }

  // The booking's services are rewritten on every save, whatever changed:
  // status and booking_date are copied onto each service row (the exclusion
  // constraint needs them there, see db/schema.ts), and startMin changing
  // shifts every service's own slice with it. Recomputing unconditionally is
  // one code path instead of "which fields actually need this," which is
  // exactly the kind of divergence a booking_services row could silently
  // drift on.
  const nextLines = computeServiceLines(nextStart, nextServiceInputs);

  const setFragments: SQL[] = [];
  if (patch.clientName !== undefined) setFragments.push(sql`"client_name" = ${patch.clientName}`);
  if (patch.clientPhone !== undefined) setFragments.push(sql`"client_phone" = ${patch.clientPhone}`);
  if (patch.bookingDate !== undefined) setFragments.push(sql`"booking_date" = ${patch.bookingDate}`);
  if (patch.startMin !== undefined) setFragments.push(sql`"start_min" = ${patch.startMin}`);
  if (patch.notes !== undefined) setFragments.push(sql`"notes" = ${patch.notes}`);
  if (patch.status !== undefined) setFragments.push(sql`"status" = ${patch.status}`);
  setFragments.push(sql`"duration_min" = ${nextDuration}`);
  setFragments.push(sql`"updated_at" = now()`);

  const row = await writeBooking(async () => {
    // One statement again: the booking row is updated, its old services are
    // deleted, and its new ones are inserted, all atomically. The insert's
    // WHERE clause reads `deleted_services` for no other reason than to force
    // Postgres to run the delete before it — sibling data-modifying CTEs run
    // in an unspecified order otherwise, and an insert that reused the same
    // (salon, date, service, start) key as a not-yet-deleted row would be
    // refused by the very constraint this is supposed to satisfy.
    const result = await db.execute<RawBookingRow>(sql`
      WITH updated_booking AS (
        UPDATE "bookings"
        SET ${sql.join(setFragments, sql`, `)}
        WHERE "id" = ${id}
        RETURNING *
      ),
      deleted_services AS (
        DELETE FROM "booking_services" WHERE "booking_id" = ${id} RETURNING "id"
      ),
      new_services AS (
        INSERT INTO "booking_services"
          ("booking_id", "salon_id", "booking_date", "status", "service", "start_min", "duration_min", "price", "sort_order")
        SELECT ub."id", ub."salon_id", ub."booking_date", ub."status", v.service, v.start_min, v.duration_min, v.price, v.sort_order
        FROM updated_booking ub, (VALUES ${serviceValueRows(nextLines)}) AS v(service, start_min, duration_min, price, sort_order)
        WHERE (SELECT count(*) FROM deleted_services) IS NOT NULL
        RETURNING *
      )
      SELECT
        ${BOOKING_COLUMNS_SQL},
        (SELECT ${SERVICES_JSON_SQL} FROM new_services ns) AS "services"
      FROM updated_booking nb
    `);
    return result.rows[0] ?? null;
  });

  return row;
}

/**
 * Cancellation is a soft delete: the row stays for the owner's future
 * reporting, and the partial constraints ignore cancelled rows so every one
 * of its chairs immediately becomes bookable again.
 */
export async function cancelBooking(id: string): Promise<BookingResult | null> {
  const result = await db.execute<RawBookingRow>(sql`
    WITH updated_booking AS (
      UPDATE "bookings"
      SET "status" = 'cancelled', "updated_at" = now()
      -- Re-cancelling an already-cancelled booking would bump updated_at and
      -- push a pointless refresh to every open calendar, so only rows that
      -- are actually live are touched.
      WHERE "id" = ${id} AND "status" <> 'cancelled'
      RETURNING *
    ),
    updated_services AS (
      UPDATE "booking_services"
      SET "status" = 'cancelled'
      WHERE "booking_id" = ${id}
        AND "status" <> 'cancelled'
        AND (SELECT count(*) FROM updated_booking) > 0
      RETURNING *
    )
    SELECT
      ${BOOKING_COLUMNS_SQL},
      (SELECT ${SERVICES_JSON_SQL} FROM updated_services ns) AS "services"
    FROM updated_booking nb
  `);

  if (result.rows[0]) return result.rows[0];

  // Nothing updated means either "no such booking" or "already cancelled".
  // The caller wants a 404 only for the first, so read the row back.
  const existing = await getBookingById(id);
  return existing ? attachServices(existing) : null;
}

export async function countBookingsInRange(
  salonId: string,
  from: string,
  to: string,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(
        eq(bookings.salonId, salonId),
        gte(bookings.bookingDate, from),
        lte(bookings.bookingDate, to),
        ne(bookings.status, "cancelled"),
      ),
    );
  return rows[0]?.count ?? 0;
}

/** A single write's result, ready for the wire. */
export function toDTO(result: BookingResult): BookingDTO {
  return toBookingDTO(result, result.services);
}

/** A list of rows, ready for the wire — one query for all of their services, not one per row. */
export async function toBookingDTOs(rows: readonly Booking[]): Promise<BookingDTO[]> {
  const withServices = await attachServicesToAll(rows);
  return withServices.map(toDTO);
}

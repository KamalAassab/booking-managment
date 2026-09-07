import "server-only";

import { and, asc, eq, gte, inArray, lte, max, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookings, salons, type Booking, type Salon } from "@/db/schema";
import { isCheckViolation, isSlotConflictError } from "./db-errors";
import { normalizePhone } from "./phone";
import { MINUTES_IN_DAY, isValidDateString, minutesToLabel } from "./time";
import type { CreateBookingInput, UpdateBookingInput } from "./validation";

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
 * A cheap change-detection watermark for the live-update poll: the newest
 * updated_at plus a row count. The count catches the one case a max() cannot
 * — a row disappearing — even though this app only soft-cancels today.
 *
 * This is the query the calendar runs every couple of seconds per open tab,
 * so it must stay index-only and tiny: it returns two numbers regardless of
 * how many bookings the day holds.
 */
export async function bookingsWatermark(
  salonIds: string[],
  date: string,
): Promise<string> {
  if (salonIds.length === 0) return "0:0";
  const rows = await db
    .select({
      latest: max(bookings.updatedAt),
      count: sql<number>`count(*)::int`,
    })
    .from(bookings)
    .where(
      and(inArray(bookings.salonId, salonIds), eq(bookings.bookingDate, date)),
    );
  const row = rows[0];
  // node-postgres hands back a Date, the Neon HTTP driver a string. Both go
  // through the same constructor so the watermark string is identical on
  // either driver — a client must not see the value change just because the
  // request happened to be served by a different runtime.
  const latest = row?.latest ? new Date(row.latest).getTime() : 0;
  return `${Number.isFinite(latest) ? latest : 0}:${row?.count ?? 0}`;
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
  throw error;
}

export async function createBooking(
  input: CreateBookingInput,
): Promise<{ booking: Booking; salon: Salon }> {
  const salon = await getSalonBySlug(input.salonSlug);
  if (!salon) throw new ValidationError("Salon introuvable.");

  const phone = normalizePhone(input.clientPhone);
  if (!phone.ok) throw new ValidationError(phone.error);

  const clientName = input.clientName.trim();
  const service = input.service.trim();
  if (!clientName) throw new ValidationError("Nom du client requis.");
  if (!service) throw new ValidationError("Service requis.");
  if (!isValidDateString(input.bookingDate)) {
    throw new ValidationError("Date invalide.");
  }

  assertWithinOpeningHours(salon, input.startMin, input.durationMin);

  try {
    const rows = await db
      .insert(bookings)
      .values({
        salonId: salon.id,
        clientName,
        clientPhone: phone.e164,
        bookingDate: input.bookingDate,
        startMin: input.startMin,
        durationMin: input.durationMin,
        service,
        notes: input.notes?.trim() ? input.notes.trim() : null,
        channel: input.channel,
      })
      .returning();

    const booking = rows[0];
    // RETURNING on a successful INSERT always yields the row; if it somehow
    // does not, failing loudly beats handing the route an undefined to
    // dereference into a 500 with no explanation.
    if (!booking) {
      throw new Error("Insert returned no row.");
    }
    return { booking, salon };
  } catch (error) {
    translateWriteError(error);
  }
}

export async function updateBooking(
  id: string,
  input: UpdateBookingInput,
): Promise<Booking | null> {
  const current = await getBookingById(id);
  if (!current) return null;

  const patch: Partial<typeof bookings.$inferInsert> = {};

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
  if (input.durationMin !== undefined) patch.durationMin = input.durationMin;
  if (input.service !== undefined) {
    const service = input.service.trim();
    if (!service) throw new ValidationError("Service requis.");
    patch.service = service;
  }
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.status !== undefined) patch.status = input.status;

  if (Object.keys(patch).length === 0) {
    // Nothing to change. Returning early avoids bumping updated_at, which
    // would wake every open calendar for a write that changed nothing.
    return current;
  }

  const nextStatus = patch.status ?? current.status;
  const nextStart = patch.startMin ?? current.startMin;
  const nextDuration = patch.durationMin ?? current.durationMin;

  // Opening hours are re-checked whenever the booking moves in time, and also
  // whenever a cancelled booking is being revived: the row may have been
  // cancelled precisely because the salon's hours changed underneath it.
  const movingInTime =
    input.startMin !== undefined ||
    input.durationMin !== undefined ||
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

  try {
    const rows = await db
      .update(bookings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(bookings.id, id))
      .returning();
    return rows[0] ?? null;
  } catch (error) {
    translateWriteError(error);
  }
}

/**
 * Cancellation is a soft delete: the row stays for the owner's future
 * reporting, and the partial constraints ignore cancelled rows so the slot
 * immediately becomes bookable again.
 */
export async function cancelBooking(id: string): Promise<Booking | null> {
  const rows = await db
    .update(bookings)
    .set({ status: "cancelled", updatedAt: new Date() })
    // Re-cancelling an already-cancelled booking would bump updated_at and
    // push a pointless refresh to every open calendar, so only rows that are
    // actually live are touched.
    .where(and(eq(bookings.id, id), ne(bookings.status, "cancelled")))
    .returning();

  // Nothing updated means either "no such booking" or "already cancelled".
  // The caller wants a 404 only for the first, so read the row back.
  return rows[0] ?? (await getBookingById(id));
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

import "server-only";

import { and, asc, eq, gte, inArray, lte, max, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookings, salons, type Booking, type Salon } from "@/db/schema";
import { normalizePhone } from "./phone";
import type { CreateBookingInput, UpdateBookingInput } from "./validation";

/**
 * Postgres error codes we translate into a friendly "slot already taken".
 *  23505 — unique_violation      (two bookings with the same start time)
 *  23P01 — exclusion_violation   (two bookings whose ranges overlap)
 */
const UNIQUE_VIOLATION = "23505";
const EXCLUSION_VIOLATION = "23P01";

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

function isSlotConflict(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === UNIQUE_VIOLATION || code === EXCLUSION_VIOLATION) return true;
  // The Neon HTTP driver surfaces the SQLSTATE in the message for some errors.
  const message = (error as { message?: string })?.message ?? "";
  return (
    message.includes("bookings_slot_unique") ||
    message.includes("bookings_no_overlap")
  );
}

export async function listSalons(): Promise<Salon[]> {
  return db.select().from(salons).orderBy(asc(salons.sortOrder), asc(salons.name));
}

export async function getSalonBySlug(slug: string): Promise<Salon | null> {
  const rows = await db.select().from(salons).where(eq(salons.slug, slug)).limit(1);
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
    .orderBy(asc(bookings.startMin));
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
    .orderBy(asc(bookings.startMin));
}

/**
 * A cheap change-detection watermark for the live-update stream: the newest
 * updated_at plus a row count. The count catches the one case a max() cannot
 * — a row disappearing — even though this app only soft-cancels today.
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
  const latest = row?.latest ? new Date(row.latest).getTime() : 0;
  return `${latest}:${row?.count ?? 0}`;
}

function assertWithinOpeningHours(
  salon: Salon,
  startMin: number,
  durationMin: number,
): void {
  if (startMin < salon.opensAtMin) {
    throw new ValidationError(
      `${salon.name} ouvre à ${String(Math.floor(salon.opensAtMin / 60)).padStart(2, "0")}:${String(salon.opensAtMin % 60).padStart(2, "0")}.`,
    );
  }
  if (startMin + durationMin > salon.closesAtMin) {
    throw new ValidationError(
      "Ce rendez-vous dépasse l'heure de fermeture du salon.",
    );
  }
  if ((startMin - salon.opensAtMin) % salon.slotMin !== 0) {
    throw new ValidationError("Heure de début hors grille horaire.");
  }
}

export async function createBooking(
  input: CreateBookingInput,
): Promise<{ booking: Booking; salon: Salon }> {
  const salon = await getSalonBySlug(input.salonSlug);
  if (!salon) throw new ValidationError("Salon introuvable.");

  const phone = normalizePhone(input.clientPhone);
  if (!phone.ok) throw new ValidationError(phone.error);

  assertWithinOpeningHours(salon, input.startMin, input.durationMin);

  try {
    const rows = await db
      .insert(bookings)
      .values({
        salonId: salon.id,
        clientName: input.clientName,
        clientPhone: phone.e164,
        bookingDate: input.bookingDate,
        startMin: input.startMin,
        durationMin: input.durationMin,
        service: input.service,
        notes: input.notes ? input.notes : null,
        channel: input.channel,
      })
      .returning();
    return { booking: rows[0], salon };
  } catch (error) {
    if (isSlotConflict(error)) throw new SlotTakenError();
    throw error;
  }
}

export async function updateBooking(
  id: string,
  input: UpdateBookingInput,
): Promise<Booking | null> {
  const existing = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, id))
    .limit(1);
  const current = existing[0];
  if (!current) return null;

  const patch: Partial<typeof bookings.$inferInsert> = { updatedAt: new Date() };

  if (input.clientName !== undefined) patch.clientName = input.clientName;
  if (input.clientPhone !== undefined) {
    const phone = normalizePhone(input.clientPhone);
    if (!phone.ok) throw new ValidationError(phone.error);
    patch.clientPhone = phone.e164;
  }
  if (input.bookingDate !== undefined) patch.bookingDate = input.bookingDate;
  if (input.startMin !== undefined) patch.startMin = input.startMin;
  if (input.durationMin !== undefined) patch.durationMin = input.durationMin;
  if (input.service !== undefined) patch.service = input.service;
  if (input.notes !== undefined) patch.notes = input.notes || null;
  if (input.status !== undefined) patch.status = input.status;

  const movingInTime =
    input.startMin !== undefined ||
    input.durationMin !== undefined ||
    input.bookingDate !== undefined;

  if (movingInTime) {
    const salonRows = await db
      .select()
      .from(salons)
      .where(eq(salons.id, current.salonId))
      .limit(1);
    const salon = salonRows[0];
    if (salon) {
      assertWithinOpeningHours(
        salon,
        patch.startMin ?? current.startMin,
        patch.durationMin ?? current.durationMin,
      );
    }
  }

  try {
    const rows = await db
      .update(bookings)
      .set(patch)
      .where(eq(bookings.id, id))
      .returning();
    return rows[0] ?? null;
  } catch (error) {
    if (isSlotConflict(error)) throw new SlotTakenError();
    throw error;
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
    .where(eq(bookings.id, id))
    .returning();
  return rows[0] ?? null;
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
        sql`${bookings.status} <> 'cancelled'`,
      ),
    );
  return rows[0]?.count ?? 0;
}

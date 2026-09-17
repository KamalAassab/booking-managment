import { isUuid } from "@/lib/api";
import { normalizePhone } from "@/lib/phone";
import {
  MINUTES_IN_DAY,
  isValidDateString,
  nowMinutesInSalonTz,
  rangesOverlap,
  todayInSalonTz,
} from "@/lib/time";
import type { BookingDTO, BookingServiceDTO } from "@/lib/types";

/**
 * An independent, in-memory statement of the booking rules.
 *
 * The randomized suites drive the real API and this model with the same
 * operations and require the two to agree on every status code and every
 * stored field. It is written from the rules as the business states them —
 * opening hours, the grid, one chair per service, cancelled frees the slot —
 * not by reading the implementation, so a divergence is a question about
 * which one is wrong rather than a restatement of the same bug.
 */

export type ModelSalon = {
  id: string;
  slug: string;
  opensAtMin: number;
  closesAtMin: number;
  slotMin: number;
};

type Outcome =
  | { status: 200 | 201; booking: BookingDTO }
  | { status: 400 | 404 | 409 };

const STATUSES = ["confirmed", "cancelled", "done"] as const;
const CHANNELS = ["call_center", "front_desk"] as const;
const MAX_SERVICES_PER_BOOKING = 8;

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function textOk(v: unknown, min: number, max: number): v is string {
  return typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
}

/** Same service means the same chair, however staff capitalised or spaced it. */
export function serviceKey(service: string): string {
  return service.trim().toLowerCase();
}

type ServiceLineInput = { service: string; durationMin: number; price: number };

/** Validates a raw `services` field into trimmed, typed lines, or null. */
function validateServiceLines(v: unknown): ServiceLineInput[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_SERVICES_PER_BOOKING) return null;
  const lines: ServiceLineInput[] = [];
  for (const raw of v) {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (!textOk(r.service, 1, 120)) return null;
    if (!(isInt(r.durationMin) && r.durationMin >= 5 && r.durationMin <= 480)) return null;
    if (r.price !== undefined && !(isInt(r.price) && r.price >= 0 && r.price <= 100_000)) return null;
    lines.push({
      service: (r.service as string).trim(),
      durationMin: r.durationMin as number,
      price: (r.price as number | undefined) ?? 0,
    });
  }
  return lines;
}

/** Every line back to back from `startMin`. */
function placeServiceLines(startMin: number, lines: readonly ServiceLineInput[]): BookingServiceDTO[] {
  let cursor = startMin;
  return lines.map((l) => {
    const line: BookingServiceDTO = { service: l.service, startMin: cursor, durationMin: l.durationMin, price: l.price };
    cursor += l.durationMin;
    return line;
  });
}

function totalDuration(lines: readonly { durationMin: number }[]): number {
  return lines.reduce((sum, l) => sum + l.durationMin, 0);
}

function joinServiceLabel(lines: readonly { service: string }[]): string {
  return lines.map((l) => l.service).join(" + ");
}

export class BookingModel {
  readonly bookings = new Map<string, BookingDTO>();
  private readonly salonsBySlug = new Map<string, ModelSalon>();
  private readonly salonsById = new Map<string, ModelSalon>();

  constructor(salons: ModelSalon[]) {
    for (const salon of salons) {
      this.salonsBySlug.set(salon.slug, salon);
      this.salonsById.set(salon.id, salon);
    }
  }

  private fitsHours(salon: ModelSalon, startMin: number, durationMin: number): boolean {
    return (
      startMin + durationMin <= MINUTES_IN_DAY &&
      startMin >= salon.opensAtMin &&
      startMin + durationMin <= salon.closesAtMin &&
      (startMin - salon.opensAtMin) % salon.slotMin === 0
    );
  }

  private conflicts(candidate: BookingDTO): boolean {
    if (candidate.status === "cancelled") return false;
    for (const other of this.bookings.values()) {
      if (other.id === candidate.id || other.status === "cancelled") continue;
      if (other.salonId !== candidate.salonId || other.bookingDate !== candidate.bookingDate) continue;
      for (const cs of candidate.services) {
        for (const os of other.services) {
          if (
            serviceKey(os.service) === serviceKey(cs.service) &&
            rangesOverlap(cs.startMin, cs.durationMin, os.startMin, os.durationMin)
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /** Predicts POST /api/bookings. Does not mutate; call `commitCreate`. */
  predictCreate(body: Record<string, unknown>): Outcome {
    const today = todayInSalonTz();
    const b = body;
    const lines = validateServiceLines(b.services);
    if (
      !(typeof b.salonSlug === "string" && b.salonSlug.length >= 1 && b.salonSlug.length <= 24) ||
      !textOk(b.clientName, 2, 120) ||
      !textOk(b.clientPhone, 1, 32) ||
      !isValidDateString(b.bookingDate) ||
      !(isInt(b.startMin) && b.startMin >= 0 && b.startMin <= MINUTES_IN_DAY - 1) ||
      !lines ||
      !(b.notes === undefined || (typeof b.notes === "string" && b.notes.length <= 1000)) ||
      !CHANNELS.includes(b.channel as (typeof CHANNELS)[number])
    ) {
      return { status: 400 };
    }
    const startMin = b.startMin as number;
    const durationMin = totalDuration(lines);
    const bookingDate = b.bookingDate as string;
    if (startMin + durationMin > MINUTES_IN_DAY) return { status: 400 };
    if (bookingDate < today) return { status: 400 };
    if (bookingDate === today && startMin < nowMinutesInSalonTz()) return { status: 400 };

    const salon = this.salonsBySlug.get(b.salonSlug as string);
    if (!salon) return { status: 400 };
    const phone = normalizePhone(b.clientPhone as string);
    if (!phone.ok) return { status: 400 };
    if (!this.fitsHours(salon, startMin, durationMin)) return { status: 400 };

    const notes = typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : null;
    const services = placeServiceLines(startMin, lines);
    const booking: BookingDTO = {
      id: "(pending)",
      salonId: salon.id,
      clientName: (b.clientName as string).trim(),
      clientPhone: phone.e164,
      bookingDate,
      startMin,
      durationMin,
      services,
      serviceLabel: joinServiceLabel(services),
      notes,
      status: "confirmed",
      channel: b.channel as BookingDTO["channel"],
    };
    if (this.conflicts(booking)) return { status: 409 };
    return { status: 201, booking };
  }

  commitCreate(booking: BookingDTO): void {
    this.bookings.set(booking.id, booking);
  }

  /** Predicts PATCH /api/bookings/[id]. Does not mutate; call `commitUpdate`. */
  predictUpdate(id: string, patch: Record<string, unknown>): Outcome {
    const today = todayInSalonTz();
    if (!isUuid(id)) return { status: 400 };
    const p = patch;
    const lines = p.services !== undefined ? validateServiceLines(p.services) : undefined;
    if (
      (p.clientName !== undefined && !textOk(p.clientName, 2, 120)) ||
      (p.clientPhone !== undefined && !textOk(p.clientPhone, 1, 32)) ||
      (p.bookingDate !== undefined && !isValidDateString(p.bookingDate)) ||
      (p.startMin !== undefined && !(isInt(p.startMin) && p.startMin >= 0 && p.startMin <= MINUTES_IN_DAY - 1)) ||
      (p.services !== undefined && !lines) ||
      (p.notes !== undefined && !(typeof p.notes === "string" && p.notes.length <= 1000)) ||
      (p.status !== undefined && !STATUSES.includes(p.status as (typeof STATUSES)[number]))
    ) {
      return { status: 400 };
    }

    const current = this.bookings.get(id);
    if (!current) return { status: 404 };

    const nextStartMin = p.startMin !== undefined ? (p.startMin as number) : current.startMin;
    const nextLines: ServiceLineInput[] =
      lines ?? current.services.map((s) => ({ service: s.service, durationMin: s.durationMin, price: s.price }));
    const nextDuration = totalDuration(nextLines);
    if (
      (p.startMin !== undefined || p.services !== undefined) &&
      nextStartMin + nextDuration > MINUTES_IN_DAY
    ) {
      return { status: 400 };
    }
    if (p.bookingDate !== undefined && (p.bookingDate as string) < today) return { status: 400 };

    const next: BookingDTO = { ...current };
    if (p.clientName !== undefined) next.clientName = (p.clientName as string).trim();
    if (p.clientPhone !== undefined) {
      const phone = normalizePhone(p.clientPhone as string);
      if (!phone.ok) return { status: 400 };
      next.clientPhone = phone.e164;
    }
    if (p.bookingDate !== undefined) next.bookingDate = p.bookingDate as string;
    next.startMin = nextStartMin;
    next.services = placeServiceLines(nextStartMin, nextLines);
    next.durationMin = nextDuration;
    next.serviceLabel = joinServiceLabel(next.services);
    if (p.notes !== undefined) next.notes = (p.notes as string).trim() || null;
    if (p.status !== undefined) next.status = p.status as BookingDTO["status"];

    const movingInTime =
      p.startMin !== undefined || p.services !== undefined || p.bookingDate !== undefined;
    const reviving = current.status === "cancelled" && next.status !== "cancelled";
    if (movingInTime || reviving) {
      const salon = this.salonsById.get(current.salonId);
      if (!salon || !this.fitsHours(salon, next.startMin, next.durationMin)) {
        return { status: 400 };
      }
    }
    if (this.conflicts(next)) return { status: 409 };
    return { status: 200, booking: next };
  }

  commitUpdate(booking: BookingDTO): void {
    this.bookings.set(booking.id, booking);
  }

  /** Predicts DELETE /api/bookings/[id]. */
  predictCancel(id: string): Outcome {
    if (!isUuid(id)) return { status: 400 };
    const current = this.bookings.get(id);
    if (!current) return { status: 404 };
    return { status: 200, booking: { ...current, status: "cancelled" } };
  }

  /** What GET /api/bookings should return for one salon's day. */
  day(salonId: string, date: string): BookingDTO[] {
    return [...this.bookings.values()]
      .filter((b) => b.salonId === salonId && b.bookingDate === date)
      .sort((a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id));
  }
}

/** A day's rows in a comparison-stable order (the API breaks start ties by creation time). */
export function canonical(rows: BookingDTO[]): BookingDTO[] {
  return [...rows].sort((a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id));
}

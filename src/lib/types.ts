import type { Booking, Salon } from "@/db/schema";

/**
 * Plain shapes crossing the server/client boundary.
 *
 * The database row carries `Date` objects and audit columns the UI never
 * reads. Mapping to an explicit DTO keeps the initial server render and the
 * JSON that arrives over the live stream byte-identical, so the client never
 * has to care which of the two it is looking at.
 */

export type BookingStatus = "confirmed" | "cancelled" | "done";
export type BookingChannel = "call_center" | "front_desk";

export type BookingDTO = {
  id: string;
  salonId: string;
  clientName: string;
  clientPhone: string;
  bookingDate: string;
  startMin: number;
  durationMin: number;
  service: string;
  notes: string | null;
  status: BookingStatus;
  channel: BookingChannel;
};

export type SalonDTO = {
  id: string;
  slug: string;
  name: string;
  opensAtMin: number;
  closesAtMin: number;
  slotMin: number;
};

export function toBookingDTO(row: Booking): BookingDTO {
  return {
    id: row.id,
    salonId: row.salonId,
    clientName: row.clientName,
    clientPhone: row.clientPhone,
    bookingDate: row.bookingDate,
    startMin: row.startMin,
    durationMin: row.durationMin,
    service: row.service,
    notes: row.notes,
    status: row.status,
    channel: row.channel,
  };
}

export function toSalonDTO(row: Salon): SalonDTO {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    opensAtMin: row.opensAtMin,
    closesAtMin: row.closesAtMin,
    slotMin: row.slotMin,
  };
}

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

/** One line item of a booking, in the order it runs. */
export type BookingServiceDTO = {
  service: string;
  /** This service's own slice of the visit — sums to the booking's durationMin. */
  startMin: number;
  durationMin: number;
  price: number;
};

export type BookingDTO = {
  id: string;
  salonId: string;
  clientName: string;
  clientPhone: string;
  bookingDate: string;
  startMin: number;
  /** Sum of `services[].durationMin` — the whole visit's block on the calendar. */
  durationMin: number;
  services: BookingServiceDTO[];
  /** "Coupe + Coloration" — every place that used to show one service name. */
  serviceLabel: string;
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

/** Joins a booking's services into the one string every card and message shows. */
export function formatServiceLabel(services: readonly { service: string }[]): string {
  return services.map((s) => s.service).join(" + ");
}

export function toBookingDTO(
  row: Booking,
  serviceLines: readonly {
    service: string;
    startMin: number;
    durationMin: number;
    price: number;
    sortOrder: number;
  }[],
): BookingDTO {
  const services = [...serviceLines]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({
      service: s.service,
      startMin: s.startMin,
      durationMin: s.durationMin,
      price: s.price,
    }));
  return {
    id: row.id,
    salonId: row.salonId,
    clientName: row.clientName,
    clientPhone: row.clientPhone,
    bookingDate: row.bookingDate,
    startMin: row.startMin,
    durationMin: row.durationMin,
    services,
    serviceLabel: formatServiceLabel(services),
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

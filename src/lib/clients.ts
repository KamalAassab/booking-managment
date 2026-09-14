import "server-only";

import { desc, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookings, salons, type Booking } from "@/db/schema";
import { formatPhoneForDisplay } from "./phone";

export type ClientSummary = {
  clientName: string;
  clientPhone: string;
  formattedPhone: string;
  totalBookings: number;
  doneBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  lastBookingDate: string;
  lastService: string;
  salonsVisited: string[];
  recentBookings: {
    id: string;
    bookingDate: string;
    startMin: number;
    durationMin: number;
    service: string;
    status: "confirmed" | "cancelled" | "done";
    salonName: string;
    salonSlug: string;
  }[];
};

export type ClientSuggestion = {
  name: string;
  phone: string;
  formattedPhone: string;
  totalBookings: number;
  lastService: string;
};

/**
 * Returns all unique clients with their statistics and booking history.
 */
export async function listAllClients(): Promise<ClientSummary[]> {
  const allBookings = await db
    .select({
      id: bookings.id,
      clientName: bookings.clientName,
      clientPhone: bookings.clientPhone,
      bookingDate: bookings.bookingDate,
      startMin: bookings.startMin,
      durationMin: bookings.durationMin,
      service: bookings.service,
      status: bookings.status,
      salonId: bookings.salonId,
      salonName: salons.name,
      salonSlug: salons.slug,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .leftJoin(salons, eq(bookings.salonId, salons.id))
    .orderBy(desc(bookings.bookingDate), desc(bookings.startMin));

  // Group by clientPhone (or clientName if phone empty)
  const map = new Map<string, {
    clientName: string;
    clientPhone: string;
    totalBookings: number;
    doneBookings: number;
    confirmedBookings: number;
    cancelledBookings: number;
    lastBookingDate: string;
    lastService: string;
    salonsSet: Set<string>;
    recentBookings: ClientSummary["recentBookings"];
  }>();

  for (const b of allBookings) {
    const key = b.clientPhone.trim() || b.clientName.trim().toLowerCase();
    if (!key) continue;

    let existing = map.get(key);
    if (!existing) {
      existing = {
        clientName: b.clientName,
        clientPhone: b.clientPhone,
        totalBookings: 0,
        doneBookings: 0,
        confirmedBookings: 0,
        cancelledBookings: 0,
        lastBookingDate: b.bookingDate,
        lastService: b.service,
        salonsSet: new Set<string>(),
        recentBookings: [],
      };
      map.set(key, existing);
    }

    existing.totalBookings++;
    if (b.status === "done") existing.doneBookings++;
    else if (b.status === "confirmed") existing.confirmedBookings++;
    else if (b.status === "cancelled") existing.cancelledBookings++;

    if (b.salonName) existing.salonsSet.add(b.salonName);

    if (existing.recentBookings.length < 10) {
      existing.recentBookings.push({
        id: b.id,
        bookingDate: b.bookingDate,
        startMin: b.startMin,
        durationMin: b.durationMin,
        service: b.service,
        status: b.status,
        salonName: b.salonName ?? "Salon",
        salonSlug: b.salonSlug ?? "vip",
      });
    }
  }

  const clients: ClientSummary[] = Array.from(map.values()).map((c) => ({
    clientName: c.clientName,
    clientPhone: c.clientPhone,
    formattedPhone: formatPhoneForDisplay(c.clientPhone),
    totalBookings: c.totalBookings,
    doneBookings: c.doneBookings,
    confirmedBookings: c.confirmedBookings,
    cancelledBookings: c.cancelledBookings,
    lastBookingDate: c.lastBookingDate,
    lastService: c.lastService,
    salonsVisited: Array.from(c.salonsSet),
    recentBookings: c.recentBookings,
  }));

  // Sort by totalBookings desc, then lastBookingDate desc
  clients.sort((a, b) => b.totalBookings - a.totalBookings || b.lastBookingDate.localeCompare(a.lastBookingDate));

  return clients;
}

/**
 * Searches clients by name or phone for fast autocomplete suggestions.
 */
export async function searchClientSuggestions(query: string): Promise<ClientSuggestion[]> {
  const q = query.trim();
  if (!q) return [];

  const raw = await db
    .select({
      clientName: bookings.clientName,
      clientPhone: bookings.clientPhone,
      service: bookings.service,
      bookingDate: bookings.bookingDate,
    })
    .from(bookings)
    .where(
      or(
        ilike(bookings.clientName, `%${q}%`),
        ilike(bookings.clientPhone, `%${q}%`),
      ),
    )
    .orderBy(desc(bookings.bookingDate))
    .limit(50);

  const seen = new Map<string, ClientSuggestion>();
  for (const r of raw) {
    const key = r.clientPhone.trim() || r.clientName.trim().toLowerCase();
    const existing = seen.get(key);
    if (existing) {
      existing.totalBookings++;
    } else {
      seen.set(key, {
        name: r.clientName,
        phone: r.clientPhone,
        formattedPhone: formatPhoneForDisplay(r.clientPhone),
        totalBookings: 1,
        lastService: r.service,
      });
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.totalBookings - a.totalBookings)
    .slice(0, 8);
}

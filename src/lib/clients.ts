import "server-only";

import { desc, eq, ilike, or } from "drizzle-orm";

import { db } from "@/db";
import { bookings, salons } from "@/db/schema";
import { loadServicesFor } from "./bookings";
import { formatPhoneForDisplay } from "./phone";
import { todayInSalonTz } from "./time";
import { formatServiceLabel } from "./types";

export type ClientSummary = {
  clientName: string;
  clientPhone: string;
  formattedPhone: string;
  totalBookings: number;
  doneBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  /** The most recent booking of any kind, future ones included: for sorting by activity. */
  lastBookingDate: string;
  lastService: string;
  /** The latest day the client actually came (or was due), never a future date. */
  lastVisitDate: string | null;
  /** The next confirmed booking from today on, if any. */
  nextBooking: { bookingDate: string; startMin: number; service: string } | null;
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
  /** For display. */
  lastService: string;
  /** For prefilling a new booking's service lines, one entry per service. */
  lastServices: string[];
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
      status: bookings.status,
      salonId: bookings.salonId,
      salonName: salons.name,
      salonSlug: salons.slug,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .leftJoin(salons, eq(bookings.salonId, salons.id))
    .orderBy(desc(bookings.bookingDate), desc(bookings.startMin));

  const serviceLabels = await loadServicesFor(allBookings.map((b) => b.id));
  const labelFor = (bookingId: string) => formatServiceLabel(serviceLabels.get(bookingId) ?? []);

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
    lastVisitDate: string | null;
    nextBooking: ClientSummary["nextBooking"];
    salonsSet: Set<string>;
    recentBookings: ClientSummary["recentBookings"];
  }>();

  const today = todayInSalonTz();

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
        lastService: labelFor(b.id),
        lastVisitDate: null,
        nextBooking: null,
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

    // Rows arrive newest first: the first past one is the last visit, and
    // the last upcoming one seen is the soonest.
    if (b.status !== "cancelled") {
      if (b.bookingDate < today || (b.bookingDate === today && b.status === "done")) {
        existing.lastVisitDate ??= b.bookingDate;
      } else if (b.status === "confirmed") {
        existing.nextBooking = { bookingDate: b.bookingDate, startMin: b.startMin, service: labelFor(b.id) };
      }
    }

    if (existing.recentBookings.length < 10) {
      existing.recentBookings.push({
        id: b.id,
        bookingDate: b.bookingDate,
        startMin: b.startMin,
        durationMin: b.durationMin,
        service: labelFor(b.id),
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
    lastVisitDate: c.lastVisitDate,
    nextBooking: c.nextBooking,
    salonsVisited: Array.from(c.salonsSet),
    recentBookings: c.recentBookings,
  }));

  // Sort by totalBookings desc, then lastBookingDate desc
  clients.sort((a, b) => b.totalBookings - a.totalBookings || b.lastBookingDate.localeCompare(a.lastBookingDate));

  return clients;
}

/**
 * The typed text as a "contains" pattern. `%`, `_` and `\` are LIKE syntax,
 * so they are escaped: a search for "100%" must not match every client.
 */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Searches clients by name or phone for fast autocomplete suggestions.
 */
export async function searchClientSuggestions(query: string): Promise<ClientSuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  const pattern = containsPattern(q);
  // Phones are stored as +212..., but people type them the national way:
  // "0612 34" is looked up as "+212612" plus the rest of its digits.
  const digits = q.replace(/[\s.\-/()]/g, "");
  const national = /^0\d{2,}$/.test(digits) ? containsPattern(`+212${digits.slice(1)}`) : null;

  const raw = await db
    .select({
      id: bookings.id,
      clientName: bookings.clientName,
      clientPhone: bookings.clientPhone,
      bookingDate: bookings.bookingDate,
    })
    .from(bookings)
    .where(
      or(
        ilike(bookings.clientName, pattern),
        ilike(bookings.clientPhone, pattern),
        ...(national ? [ilike(bookings.clientPhone, national)] : []),
      ),
    )
    .orderBy(desc(bookings.bookingDate))
    .limit(50);

  const serviceLabels = await loadServicesFor(raw.map((r) => r.id));

  const seen = new Map<string, ClientSuggestion>();
  for (const r of raw) {
    const key = r.clientPhone.trim() || r.clientName.trim().toLowerCase();
    const existing = seen.get(key);
    if (existing) {
      existing.totalBookings++;
    } else {
      const lines = serviceLabels.get(r.id) ?? [];
      seen.set(key, {
        name: r.clientName,
        phone: r.clientPhone,
        formattedPhone: formatPhoneForDisplay(r.clientPhone),
        totalBookings: 1,
        lastService: formatServiceLabel(lines),
        lastServices: lines.map((l) => l.service),
      });
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.totalBookings - a.totalBookings)
    .slice(0, 8);
}

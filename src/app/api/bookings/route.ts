import { getSession } from "@/lib/auth";
import {
  errorResponse,
  jsonNoStore,
  readJson,
  unauthorized,
} from "@/lib/api";
import { createBooking, getSalonBySlug, listBookings } from "@/lib/bookings";
import { nowMinutesInSalonTz, todayInSalonTz } from "@/lib/time";
import { toBookingDTO } from "@/lib/types";
import { createBookingSchema, listQuerySchema } from "@/lib/validation";
import { buildWhatsAppLink } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      salon: url.searchParams.get("salon") ?? "",
      date: url.searchParams.get("date") ?? "",
    });
    if (!parsed.success) {
      return jsonNoStore({ error: "Requête invalide." }, 400);
    }

    const salon = await getSalonBySlug(parsed.data.salon);
    if (!salon) return jsonNoStore({ error: "Salon introuvable." }, 404);

    const rows = await listBookings(salon.id, parsed.data.date);
    return jsonNoStore({ bookings: rows.map(toBookingDTO) });
  } catch (error) {
    return errorResponse(error, "GET /api/bookings");
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const body = await readJson(request);
    if (body === null) {
      return jsonNoStore({ error: "Corps de requête invalide." }, 400);
    }

    const parsed = createBookingSchema.safeParse(body);
    if (!parsed.success) {
      return jsonNoStore(
        { error: parsed.error.issues[0]?.message ?? "Données invalides." },
        400,
      );
    }

    const today = todayInSalonTz();
    if (parsed.data.bookingDate < today) {
      return jsonNoStore({ error: "Impossible de réserver une date passée." }, 400);
    }
    if (parsed.data.bookingDate === today && parsed.data.startMin < nowMinutesInSalonTz()) {
      return jsonNoStore({ error: "Ce créneau est déjà passé." }, 400);
    }

    const { booking, salon } = await createBooking(parsed.data);

    const whatsappUrl = buildWhatsAppLink({
      clientName: booking.clientName,
      clientPhone: booking.clientPhone,
      salonName: salon.name,
      salonSlug: salon.slug,
      bookingDate: booking.bookingDate,
      startMin: booking.startMin,
      durationMin: booking.durationMin,
      service: booking.service,
      notes: booking.notes,
    });

    return jsonNoStore({ booking: toBookingDTO(booking), whatsappUrl }, 201);
  } catch (error) {
    return errorResponse(error, "POST /api/bookings");
  }
}

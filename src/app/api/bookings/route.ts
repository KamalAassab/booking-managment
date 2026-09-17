import { getSession } from "@/lib/auth";
import {
  errorResponse,
  jsonNoStore,
  readJson,
  unauthorized,
} from "@/lib/api";
import { createBooking, getSalonBySlug, listBookings, toBookingDTOs } from "@/lib/bookings";
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
    return jsonNoStore({ bookings: await toBookingDTOs(rows) });
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

    // Past dates and slots that have already ended are refused inside
    // createBooking, where the salon's slot length is known.
    const { booking, services, salon } = await createBooking(parsed.data);

    const whatsappUrl = buildWhatsAppLink({
      clientName: booking.clientName,
      clientPhone: booking.clientPhone,
      salonName: salon.name,
      salonSlug: salon.slug,
      bookingDate: booking.bookingDate,
      startMin: booking.startMin,
      services,
      notes: booking.notes,
    });

    return jsonNoStore({ booking: toBookingDTO(booking, services), whatsappUrl }, 201);
  } catch (error) {
    return errorResponse(error, "POST /api/bookings");
  }
}

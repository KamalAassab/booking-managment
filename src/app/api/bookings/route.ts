import { getSession } from "@/lib/auth";
import {
  errorResponse,
  jsonNoStore,
  readJson,
  unauthorized,
} from "@/lib/api";
import { createBooking, getSalonBySlug, listBookings } from "@/lib/bookings";
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

    const { booking, salon } = await createBooking(parsed.data);

    // The wa.me link is only built for the call-centre flow. Front-desk staff
    // already have the client's Instagram/WhatsApp thread open — that is how
    // the booking reached them — so they reply there by hand (brief §3).
    const whatsappUrl =
      booking.channel === "call_center"
        ? buildWhatsAppLink({
            clientName: booking.clientName,
            clientPhone: booking.clientPhone,
            salonName: salon.name,
            bookingDate: booking.bookingDate,
            startMin: booking.startMin,
            service: booking.service,
          })
        : null;

    return jsonNoStore({ booking: toBookingDTO(booking), whatsappUrl }, 201);
  } catch (error) {
    return errorResponse(error, "POST /api/bookings");
  }
}

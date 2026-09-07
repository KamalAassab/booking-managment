import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  SlotTakenError,
  ValidationError,
  createBooking,
  getSalonBySlug,
  listBookings,
} from "@/lib/bookings";
import { toBookingDTO } from "@/lib/types";
import { createBookingSchema, listQuerySchema } from "@/lib/validation";
import { buildWhatsAppLink } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse({
    salon: url.searchParams.get("salon") ?? "",
    date: url.searchParams.get("date") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const salon = await getSalonBySlug(parsed.data.salon);
  if (!salon) {
    return NextResponse.json({ error: "Salon introuvable." }, { status: 404 });
  }

  const rows = await listBookings(salon.id, parsed.data.date);
  return NextResponse.json(
    { bookings: rows.map(toBookingDTO) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const parsed = createBookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Données invalides." },
      { status: 400 },
    );
  }

  try {
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

    return NextResponse.json(
      { booking: toBookingDTO(booking), whatsappUrl },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SlotTakenError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("POST /api/bookings failed", error);
    return NextResponse.json(
      { error: "Erreur serveur. Réessayez." },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  SlotTakenError,
  ValidationError,
  cancelBooking,
  updateBooking,
} from "@/lib/bookings";
import { toBookingDTO } from "@/lib/types";
import { updateBookingSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/bookings/[id]">,
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const parsed = updateBookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Données invalides." },
      { status: 400 },
    );
  }

  try {
    const booking = await updateBooking(id, parsed.data);
    if (!booking) {
      return NextResponse.json(
        { error: "Réservation introuvable." },
        { status: 404 },
      );
    }
    return NextResponse.json({ booking: toBookingDTO(booking) });
  } catch (error) {
    if (error instanceof SlotTakenError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("PATCH /api/bookings/[id] failed", error);
    return NextResponse.json(
      { error: "Erreur serveur. Réessayez." },
      { status: 500 },
    );
  }
}

/** Soft-cancel — the row stays for reporting, the slot frees up immediately. */
export async function DELETE(
  _request: Request,
  { params }: RouteContext<"/api/bookings/[id]">,
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 });
  }

  const booking = await cancelBooking(id);
  if (!booking) {
    return NextResponse.json(
      { error: "Réservation introuvable." },
      { status: 404 },
    );
  }
  return NextResponse.json({ booking: toBookingDTO(booking) });
}

import { getSession } from "@/lib/auth";
import {
  errorResponse,
  isUuid,
  jsonNoStore,
  readJson,
  unauthorized,
} from "@/lib/api";
import { cancelBooking, updateBooking } from "@/lib/bookings";
import { toBookingDTO } from "@/lib/types";
import { updateBookingSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/bookings/[id]">,
) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const { id } = await params;
    if (!isUuid(id)) {
      return jsonNoStore({ error: "Identifiant invalide." }, 400);
    }

    const body = await readJson(request);
    if (body === null) {
      return jsonNoStore({ error: "Corps de requête invalide." }, 400);
    }

    const parsed = updateBookingSchema.safeParse(body);
    if (!parsed.success) {
      return jsonNoStore(
        { error: parsed.error.issues[0]?.message ?? "Données invalides." },
        400,
      );
    }

    const booking = await updateBooking(id, parsed.data);
    if (!booking) {
      return jsonNoStore({ error: "Réservation introuvable." }, 404);
    }
    return jsonNoStore({ booking: toBookingDTO(booking) });
  } catch (error) {
    return errorResponse(error, "PATCH /api/bookings/[id]");
  }
}

/** Soft-cancel — the row stays for reporting, the slot frees up immediately. */
export async function DELETE(
  _request: Request,
  { params }: RouteContext<"/api/bookings/[id]">,
) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const { id } = await params;
    if (!isUuid(id)) {
      return jsonNoStore({ error: "Identifiant invalide." }, 400);
    }

    const booking = await cancelBooking(id);
    if (!booking) {
      return jsonNoStore({ error: "Réservation introuvable." }, 404);
    }
    return jsonNoStore({ booking: toBookingDTO(booking) });
  } catch (error) {
    return errorResponse(error, "DELETE /api/bookings/[id]");
  }
}

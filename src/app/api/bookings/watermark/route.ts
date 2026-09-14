import { getSession } from "@/lib/auth";
import { errorResponse, jsonNoStore, unauthorized } from "@/lib/api";
import { bookingsWatermark, getSalonBySlug, listBookings } from "@/lib/bookings";
import { toBookingDTO } from "@/lib/types";
import { listQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Change detection for the live calendar (brief §3: a slot must disappear for
 * everyone the instant it is taken, not on a slow poll).
 *
 * Polling optimization: supports `since=${watermark}` query param.
 * - If unchanged: returns `{ watermark, changed: false }` with zero overhead.
 * - If changed: returns `{ watermark, changed: true, bookings }` in a single
 *   roundtrip, eliminating the secondary refetch waterfall.
 */
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

    const watermark = await bookingsWatermark([salon.id], parsed.data.date);
    const since = url.searchParams.get("since");

    if (since !== null) {
      if (since === watermark) {
        return jsonNoStore({ watermark, changed: false });
      }
      const rows = await listBookings(salon.id, parsed.data.date);
      return jsonNoStore({
        watermark,
        changed: true,
        bookings: rows.map(toBookingDTO),
      });
    }

    return jsonNoStore({ watermark, changed: true });
  } catch (error) {
    return errorResponse(error, "GET /api/bookings/watermark");
  }
}

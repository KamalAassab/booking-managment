import { getSession } from "@/lib/auth";
import { errorResponse, jsonNoStore, unauthorized } from "@/lib/api";
import { getSalonBySlug, listBookingsInRange, toBookingDTOs } from "@/lib/bookings";
import { rangeQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Powers the month calendar's day tags — a coarser, less frequent cousin of
 * GET /api/bookings that returns a whole date range instead of one day. Not
 * polled: the grid refreshes when the visible month or salon changes, and
 * after a create/edit/cancel, not on a timer.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const url = new URL(request.url);
    const parsed = rangeQuerySchema.safeParse({
      salon: url.searchParams.get("salon") ?? "",
      from: url.searchParams.get("from") ?? "",
      to: url.searchParams.get("to") ?? "",
    });
    if (!parsed.success) {
      return jsonNoStore({ error: "Requête invalide." }, 400);
    }

    const salon = await getSalonBySlug(parsed.data.salon);
    if (!salon) return jsonNoStore({ error: "Salon introuvable." }, 404);

    const rows = await listBookingsInRange(
      salon.id,
      parsed.data.from,
      parsed.data.to,
    );
    return jsonNoStore({ bookings: await toBookingDTOs(rows) });
  } catch (error) {
    return errorResponse(error, "GET /api/bookings/range");
  }
}

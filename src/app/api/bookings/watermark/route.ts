import { getSession } from "@/lib/auth";
import { errorResponse, jsonNoStore, unauthorized } from "@/lib/api";
import {
  bookingsRangeWatermark,
  bookingsWatermark,
  getSalonBySlug,
  listBookings,
} from "@/lib/bookings";
import { daysBetween, isValidDateString } from "@/lib/time";
import { toBookingDTO } from "@/lib/types";
import { listQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The widest span a poll may watch: a month grid is at most six weeks. */
const MAX_RANGE_DAYS = 62;

/**
 * Change detection for the live calendar (brief §3: a slot must disappear for
 * everyone the instant it is taken, not on a slow poll).
 *
 * Polling optimization: supports `since=${watermark}` query param.
 * - If unchanged: returns `{ watermark, changed: false }` with zero overhead.
 * - If changed: returns `{ watermark, changed: true, bookings }` in a single
 *   roundtrip, eliminating the secondary refetch waterfall.
 *
 * The week and month views also pass the visible span as `from`/`to` with
 * `sinceRange`, and get `rangeWatermark`/`rangeChanged` back: without it a
 * booking made on any day but the selected one never reached their screen.
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

    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const wantsRange = from !== null || to !== null;
    if (
      wantsRange &&
      (!isValidDateString(from) ||
        !isValidDateString(to) ||
        daysBetween(from as string, to as string) < 0 ||
        daysBetween(from as string, to as string) > MAX_RANGE_DAYS)
    ) {
      return jsonNoStore({ error: "Requête invalide." }, 400);
    }

    const salon = await getSalonBySlug(parsed.data.salon);
    if (!salon) return jsonNoStore({ error: "Salon introuvable." }, 404);

    const watermark = await bookingsWatermark([salon.id], parsed.data.date);
    const since = url.searchParams.get("since");

    const range = wantsRange
      ? await (async () => {
          const rangeWatermark = await bookingsRangeWatermark(
            [salon.id],
            from as string,
            to as string,
          );
          return {
            rangeWatermark,
            rangeChanged: url.searchParams.get("sinceRange") !== rangeWatermark,
          };
        })()
      : {};

    if (since !== null) {
      if (since === watermark) {
        return jsonNoStore({ watermark, changed: false, ...range });
      }
      const rows = await listBookings(salon.id, parsed.data.date);
      return jsonNoStore({
        watermark,
        changed: true,
        bookings: rows.map(toBookingDTO),
        ...range,
      });
    }

    return jsonNoStore({ watermark, changed: true, ...range });
  } catch (error) {
    return errorResponse(error, "GET /api/bookings/watermark");
  }
}

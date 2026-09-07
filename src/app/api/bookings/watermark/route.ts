import { getSession } from "@/lib/auth";
import { errorResponse, jsonNoStore, unauthorized } from "@/lib/api";
import { bookingsWatermark, getSalonBySlug } from "@/lib/bookings";
import { listQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Change detection for the live calendar (brief §3: a slot must disappear for
 * everyone the instant it is taken, not on a slow poll).
 *
 * This replaced a Server-Sent Events endpoint that held a connection open for
 * four minutes and polled the database once a second from inside it. That
 * design does not survive contact with Vercel:
 *
 *  - A function instance is held for the whole life of every open tab. Seven
 *    staff with the calendar open all day is seven functions running
 *    continuously — which is billed compute, and far past the €25-35/month
 *    ceiling the brief sets in §6.
 *  - The stream outlived the platform's function duration limit, so it was
 *    killed and reconnected on a loop, leaving a gap in coverage each time.
 *  - A database that had gone away produced an error event every second for
 *    four minutes, per client, with no backoff.
 *
 * The client polls this instead. Each request is a few tens of milliseconds
 * of compute and the query itself is two aggregates over an indexed range —
 * it returns the same two numbers whether the day holds one booking or a
 * hundred. When the value moves, the client refetches the day; perceived
 * latency is the poll interval, which is the same order as the second the
 * stream's own server-side poll cost.
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
    return jsonNoStore({ watermark });
  } catch (error) {
    return errorResponse(error, "GET /api/bookings/watermark");
  }
}

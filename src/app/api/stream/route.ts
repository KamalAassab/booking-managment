import { getSession } from "@/lib/auth";
import {
  bookingsWatermark,
  getSalonBySlug,
  listBookings,
} from "@/lib/bookings";
import { toBookingDTO } from "@/lib/types";
import { listQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live calendar updates (brief §3: a slot must disappear for everyone the
 * instant it is taken, not on a slow poll).
 *
 * Implementation is a Server-Sent Events stream that watches a cheap
 * (max(updated_at), count) watermark once a second and pushes the whole day
 * whenever it moves. Subscribers see a change within ~1s with no extra
 * infrastructure, no websocket service, and no recurring cost — which matters
 * given the €25–35/month ceiling in brief §6.
 *
 * Postgres LISTEN/NOTIFY would be the textbook answer, but it needs a
 * long-lived direct connection that serverless functions cannot hold
 * reliably. The client only keeps this stream open while its tab is visible,
 * so an idle browser left open overnight does not keep the Neon compute warm.
 */
const POLL_MS = 1000;
// Kept well under Vercel's function ceiling; EventSource reconnects itself.
const MAX_STREAM_MS = 4 * 60 * 1000;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return new Response("Non authentifié.", { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse({
    salon: url.searchParams.get("salon") ?? "",
    date: url.searchParams.get("date") ?? "",
  });
  if (!parsed.success) return new Response("Requête invalide.", { status: 400 });

  const salon = await getSalonBySlug(parsed.data.salon);
  if (!salon) return new Response("Salon introuvable.", { status: 404 });

  const { date } = parsed.data;
  const salonIds = [salon.id];
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting.
        }
      };

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          close();
        }
      };

      request.signal.addEventListener("abort", close);

      // Tell the browser how fast to come back after we close the stream.
      controller.enqueue(encoder.encode("retry: 2000\n\n"));

      let lastWatermark = "";
      const startedAt = Date.now();

      const tick = async () => {
        if (closed || request.signal.aborted) return close();

        try {
          const watermark = await bookingsWatermark(salonIds, date);
          if (watermark !== lastWatermark) {
            lastWatermark = watermark;
            const rows = await listBookings(salon.id, date);
            send("bookings", { bookings: rows.map(toBookingDTO) });
          } else {
            // Keeps proxies from buffering the connection shut.
            send("ping", { t: Date.now() });
          }
        } catch (error) {
          console.error("stream tick failed", error);
          send("stream-error", { message: "Connexion à la base perdue." });
        }

        if (Date.now() - startedAt > MAX_STREAM_MS) return close();
        timer = setTimeout(tick, POLL_MS);
      };

      await tick();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disables buffering on nginx-style proxies sitting in front of us.
      "X-Accel-Buffering": "no",
    },
  });
}

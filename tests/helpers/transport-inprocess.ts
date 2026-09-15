import * as bookingRoute from "@/app/api/bookings/[id]/route";
import * as rangeRoute from "@/app/api/bookings/range/route";
import * as bookingsRoute from "@/app/api/bookings/route";
import * as watermarkRoute from "@/app/api/bookings/watermark/route";
import * as healthRoute from "@/app/api/health/route";

import type { Transport, TransportRequest } from "./api-client";
import { requestContext } from "./request-context";

/**
 * Calls the real route handlers directly, the way Next.js would, inside a
 * per-request cookie context. Requires next/headers to be mocked with
 * helpers/next-headers.ts in the calling test file.
 */

const BASE = "http://atelier.test";

type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

function route(
  method: string,
  pathname: string,
): { handler: Handler | undefined; params: Record<string, string> } | null {
  const table: Record<string, Record<string, Handler | undefined>> = {
    "/api/bookings": bookingsRoute as unknown as Record<string, Handler>,
    "/api/bookings/range": rangeRoute as unknown as Record<string, Handler>,
    "/api/bookings/watermark": watermarkRoute as unknown as Record<string, Handler>,
    "/api/health": healthRoute as unknown as Record<string, Handler>,
  };
  if (table[pathname]) return { handler: table[pathname][method], params: {} };

  const match = /^\/api\/bookings\/([^/]+)$/.exec(pathname);
  if (match) {
    const handlers = bookingRoute as unknown as Record<string, Handler | undefined>;
    return {
      handler: handlers[method],
      params: { id: decodeURIComponent(match[1]) },
    };
  }
  return null;
}

export const inProcessTransport: Transport = async (req: TransportRequest) => {
  const url = new URL(req.path, BASE);
  const found = route(req.method, url.pathname);
  if (!found) return { status: 404, body: null };
  // Next.js answers a method the route file does not export with 405.
  if (!found.handler) return { status: 405, body: null };

  const cookies = new Map<string, string>();
  if (req.cookie) {
    for (const part of req.cookie.split(/;\s*/)) {
      const eq = part.indexOf("=");
      if (eq > 0) cookies.set(part.slice(0, eq), part.slice(eq + 1));
    }
  }

  const hasBody = req.rawBody !== undefined || req.body !== undefined;
  const request = new Request(url, {
    method: req.method,
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody
      ? (req.rawBody ?? JSON.stringify(req.body))
      : undefined,
  });

  const response = await requestContext.run(
    { cookies, headers: request.headers },
    () => found.handler!(request, { params: Promise.resolve(found.params) }),
  );

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
};

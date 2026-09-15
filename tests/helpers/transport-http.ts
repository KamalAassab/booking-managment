import type { Transport } from "./api-client";

/**
 * Real HTTP against a running server — `next start` on a production build.
 * Every request goes out on its own connection so five "users" genuinely
 * overlap on the wire rather than queueing behind one socket.
 */
export function httpTransport(baseUrl: string): Transport {
  return async (req) => {
    const hasBody = req.rawBody !== undefined || req.body !== undefined;
    const headers: Record<string, string> = { connection: "close" };
    if (hasBody) headers["content-type"] = "application/json";
    if (req.cookie) headers.cookie = req.cookie;

    const response = await fetch(new URL(req.path, baseUrl), {
      method: req.method,
      headers,
      body: hasBody ? (req.rawBody ?? JSON.stringify(req.body)) : undefined,
      redirect: "manual",
      cache: "no-store",
    });

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  };
}

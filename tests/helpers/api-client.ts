import { SESSION_COOKIE, createSessionToken, type Role } from "@/lib/session";
import type { BookingDTO } from "@/lib/types";

/**
 * One booking API, two ways of reaching it.
 *
 * The multi-user scenarios are written once against `UserClient` and run
 * twice: in-process against the real route handlers (every `npm test` with a
 * database), and over real HTTP against a production build (`E2E_BASE_URL`).
 * The first is fast and needs no server; the second proves the same
 * guarantees survive Next.js's own request handling, cookie parsing and a
 * separate server process holding its own connection pool.
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE" | "PUT";

export type TransportRequest = {
  method: HttpMethod;
  /** Path plus query string, e.g. `/api/bookings?salon=vip&date=2026-10-01`. */
  path: string;
  /** Serialised as JSON. */
  body?: unknown;
  /** Sent verbatim instead of `body` — for malformed-payload tests. */
  rawBody?: string;
  /** Full `name=value` cookie header, or null for a signed-out request. */
  cookie: string | null;
};

export type TransportResponse = {
  status: number;
  // Response bodies are asserted on field by field; a loose type keeps the
  // scenarios readable without a cast on every line.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
};

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export type BookingResponse = {
  booking?: BookingDTO;
  whatsappUrl?: string | null;
  error?: string;
};

export type WatermarkResponse = {
  watermark: string;
  changed: boolean;
  bookings?: BookingDTO[];
  error?: string;
};

const FAKE_USER_ID = "00000000-0000-4000-8000-000000000001";

export function sessionCookie(role: Role): string {
  const { token } = createSessionToken(FAKE_USER_ID, role);
  return `${SESSION_COOKIE}=${token}`;
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  return search.toString();
}

/** A person at a desk: one browser, one session cookie. */
export class UserClient {
  constructor(
    readonly name: string,
    private readonly transport: Transport,
    public cookie: string | null,
  ) {}

  request(method: HttpMethod, path: string, body?: unknown) {
    return this.transport({ method, path, body, cookie: this.cookie });
  }

  raw(method: HttpMethod, path: string, rawBody?: string) {
    return this.transport({ method, path, rawBody, cookie: this.cookie });
  }

  async create(input: Record<string, unknown>) {
    const res = await this.request("POST", "/api/bookings", input);
    return res as { status: number; body: BookingResponse };
  }

  async update(id: string, patch: Record<string, unknown>) {
    const res = await this.request("PATCH", `/api/bookings/${id}`, patch);
    return res as { status: number; body: BookingResponse };
  }

  async cancel(id: string) {
    const res = await this.request("DELETE", `/api/bookings/${id}`);
    return res as { status: number; body: BookingResponse };
  }

  async list(salon: string, date: string) {
    const res = await this.request(
      "GET",
      `/api/bookings?${query({ salon, date })}`,
    );
    return res as { status: number; body: { bookings?: BookingDTO[]; error?: string } };
  }

  async range(salon: string, from: string, to: string) {
    const res = await this.request(
      "GET",
      `/api/bookings/range?${query({ salon, from, to })}`,
    );
    return res as { status: number; body: { bookings?: BookingDTO[]; error?: string } };
  }

  async watermark(salon: string, date: string, since?: string) {
    const res = await this.request(
      "GET",
      `/api/bookings/watermark?${query({ salon, date, since })}`,
    );
    return res as { status: number; body: WatermarkResponse };
  }
}

export function makeUsers(
  transport: Transport,
  count: number,
  role: Role = "staff",
): UserClient[] {
  return Array.from(
    { length: count },
    (_, i) => new UserClient(`${role}-${i + 1}`, transport, sessionCookie(role)),
  );
}

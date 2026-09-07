import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless HMAC-signed session cookie. There are exactly two accounts in
 * this system, so a server-side session table would be pure overhead; the
 * only thing we need is a tamper-proof "which role is this browser".
 */

export type Role = "staff" | "owner";

export type SessionPayload = {
  sub: string;
  role: Role;
  /** Seconds since epoch. */
  iat: number;
  exp: number;
};

export const SESSION_COOKIE = "atelier_session";

// Front-desk browsers stay signed in for a month so nobody is typing a
// password at 9am with a client waiting. The owner account holds the
// password-change power, so it gets a much shorter window.
export const STAFF_SESSION_SECONDS = 60 * 60 * 24 * 30;
export const OWNER_SESSION_SECONDS = 60 * 60 * 8;

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SESSION_SECRET is missing or too short (needs at least 16 characters).",
    );
  }
  return secret;
}

function sign(data: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(data).digest());
}

export function createSessionToken(
  sub: string,
  role: Role,
  now: Date = new Date(),
): { token: string; maxAge: number } {
  const iat = Math.floor(now.getTime() / 1000);
  const maxAge = role === "owner" ? OWNER_SESSION_SECONDS : STAFF_SESSION_SECONDS;
  const payload: SessionPayload = { sub, role, iat, exp: iat + maxAge };
  const body = b64url(JSON.stringify(payload));
  return { token: `${body}.${sign(body, getSecret())}`, maxAge };
}

/** Returns null for anything tampered with, malformed, or expired. */
export function verifySessionToken(
  token: string | undefined,
  now: Date = new Date(),
): SessionPayload | null {
  if (!token) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }

  const expectedSig = sign(body, secret);
  const a = fromB64url(providedSig);
  const b = fromB64url(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }

  if (payload.role !== "staff" && payload.role !== "owner") return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  if (typeof payload.exp !== "number") return null;
  if (payload.exp <= Math.floor(now.getTime() / 1000)) return null;

  return payload;
}

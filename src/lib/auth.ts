import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  SESSION_COOKIE,
  type Role,
  type SessionPayload,
  createSessionToken,
  verifySessionToken,
} from "./session";

/** Reads and validates the session cookie. Null when signed out. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** Any signed-in role. Redirects to /login otherwise. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Owner-only pages. A staff session is signed in but must not reach the owner
 * screen, so it is bounced to /bookings rather than to /login.
 */
export async function requireOwner(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login?role=owner");
  if (session.role !== "owner") redirect("/bookings");
  return session;
}

export async function setSessionCookie(sub: string, role: Role): Promise<void> {
  const { token, maxAge } = createSessionToken(sub, role);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

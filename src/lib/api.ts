import "server-only";

import { NextResponse } from "next/server";

import { ConfigError } from "@/db";
import { NotFoundError, SlotTakenError, ValidationError } from "@/lib/bookings";
import { isConnectionError, isMissingSchemaError } from "@/lib/db-errors";

/**
 * One place that decides what an exception becomes on the wire.
 *
 * Every route used to end in `console.error(...); return 500`, which meant a
 * database that had never been migrated and a genuine bug were reported to
 * the agent identically — as "Erreur serveur. Réessayez.", advice that is
 * useless in the first case. Routes now hand their errors here instead.
 */
export function errorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof SlotTakenError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ConfigError) {
    console.error(`${context}: configuration`, error.message, error.hint);
    return NextResponse.json(
      { error: "Configuration du serveur incomplète. Prévenez l'administrateur." },
      { status: 503 },
    );
  }
  if (isMissingSchemaError(error)) {
    console.error(`${context}: schema missing`, error);
    return NextResponse.json(
      { error: "Base de données non initialisée. Prévenez l'administrateur." },
      { status: 503 },
    );
  }
  if (isConnectionError(error)) {
    console.error(`${context}: database unreachable`, error);
    return NextResponse.json(
      { error: "Base de données injoignable. Réessayez dans un instant." },
      { status: 503 },
    );
  }

  console.error(`${context} failed`, error);
  return NextResponse.json({ error: "Erreur serveur. Réessayez." }, { status: 500 });
}

/** Responses that must never be cached by a browser, proxy or the CDN. */
export const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

export function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Non authentifié." },
    { status: 401, headers: NO_STORE },
  );
}

/**
 * Postgres UUIDs as the app generates them. Checked before the value reaches
 * a query so a malformed id is a 400 rather than a driver-level 22P02 that
 * would otherwise surface as a 500.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Parses a JSON body, returning null rather than throwing on bad input. */
export async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

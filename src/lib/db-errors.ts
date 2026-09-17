/**
 * Reading the real Postgres error out of whatever the driver threw.
 *
 * This file exists because of a bug that made the single most important
 * guarantee in the system look like a crash. Drizzle 0.45 does not rethrow the
 * driver's error — it wraps it in a `DrizzleQueryError` whose own `message` is
 * "Failed query: insert into ..." and whose `code` is `undefined`. The actual
 * `PostgresError` (node-postgres) or `NeonDbError` (Neon HTTP), carrying the
 * SQLSTATE and the constraint name, is hung off `.cause`.
 *
 * Code that read `error.code` therefore never matched, so a double booking —
 * correctly rejected by the database — surfaced to the agent as a 500 "Erreur
 * serveur" instead of a 409 "ce créneau vient d'être réservé sur un autre
 * poste". Everything here walks the cause chain instead of trusting the top
 * of it, and both drivers are covered by the same code path.
 */

/** SQLSTATE codes this app reacts to by name rather than by number. */
export const SQLSTATE = {
  UNIQUE_VIOLATION: "23505",
  EXCLUSION_VIOLATION: "23P01",
  CHECK_VIOLATION: "23514",
  FOREIGN_KEY_VIOLATION: "23503",
  NOT_NULL_VIOLATION: "23502",
  UNDEFINED_TABLE: "42P01",
  UNDEFINED_COLUMN: "42703",
  UNDEFINED_OBJECT: "42704",
  INVALID_SCHEMA_NAME: "3F000",
  INVALID_PASSWORD: "28P01",
  INVALID_AUTHORIZATION: "28000",
  UNDEFINED_DATABASE: "3D000",
  INSUFFICIENT_PRIVILEGE: "42501",
  SERIALIZATION_FAILURE: "40001",
  DEADLOCK_DETECTED: "40P01",
  CHARACTER_NOT_IN_REPERTOIRE: "22021",
  UNTRANSLATABLE_CHARACTER: "22P05",
} as const;

/**
 * Every error reachable from this one, nearest first. Cycle-safe, capped.
 *
 * Three links, not one, because the drivers do not agree on where they put
 * the error they wrapped:
 *
 *  - `cause` is what Drizzle uses for the driver error, and what Node uses
 *    for a rethrow.
 *  - `sourceError` is where @neondatabase/serverless puts the failure that
 *    stopped a query reaching Neon at all. It is *not* `cause`, so a walk
 *    that only followed `cause` saw a NeonDbError with no SQLSTATE and no
 *    system code and concluded the query had simply failed — which is how a
 *    deployment that could not reach its database ended up reporting
 *    "Erreur serveur" instead of "Base de données injoignable".
 *  - `errors` is undici's: a failed `fetch` throws "fetch failed" whose cause
 *    is an AggregateError holding one ECONNREFUSED/ENOTFOUND per address
 *    that was tried. The system code lives only in there.
 */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  // Breadth-first so "nearest first" still holds once the walk branches. The
  // Set and the cap mean a self-referential error can never hang a request.
  const queue: unknown[] = [error];

  while (queue.length > 0 && chain.length < 24) {
    const current = queue.shift();
    if (current == null || seen.has(current)) continue;
    seen.add(current);
    chain.push(current);

    const link = current as {
      cause?: unknown;
      sourceError?: unknown;
      errors?: unknown;
    };
    queue.push(link.cause, link.sourceError);
    if (Array.isArray(link.errors)) queue.push(...link.errors);
  }

  return chain;
}

/**
 * The Postgres SQLSTATE, from wherever in the chain it actually lives.
 * Returns undefined for errors that are not database errors at all.
 */
export function pgErrorCode(error: unknown): string | undefined {
  for (const link of causeChain(error)) {
    const code = (link as { code?: unknown }).code;
    // node-postgres and Neon both use five-character SQLSTATE strings. Node's
    // own system errors ("ECONNREFUSED") also live on `.code`, so the shape
    // check is what keeps the two apart.
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

/** The violated constraint's name, when the driver reports one. */
export function pgConstraintName(error: unknown): string | undefined {
  for (const link of causeChain(error)) {
    const name = (link as { constraint?: unknown }).constraint;
    if (typeof name === "string" && name) return name;
  }
  return undefined;
}

/** Every message in the chain joined, for the last-resort substring checks. */
export function pgErrorMessage(error: unknown): string {
  return causeChain(error)
    .map((link) => {
      const message = (link as { message?: unknown }).message;
      return typeof message === "string" ? message : "";
    })
    .filter(Boolean)
    .join(" | ");
}

/** A Node system error code (ECONNREFUSED, ENOTFOUND, ...) from the chain. */
export function systemErrorCode(error: unknown): string | undefined {
  for (const link of causeChain(error)) {
    const code = (link as { code?: unknown }).code;
    if (typeof code === "string" && /^E[A-Z_]+$/.test(code)) return code;
  }
  return undefined;
}

/**
 * undici's own failure codes, which do not follow the `E...` convention and
 * so are invisible to `systemErrorCode`. They are what a Vercel function sees
 * when the request to Neon times out while connecting or mid-body.
 */
function undiciErrorCode(error: unknown): string | undefined {
  for (const link of causeChain(error)) {
    const code = (link as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("UND_ERR")) return code;
  }
  return undefined;
}

/**
 * The HTTP status Neon's SQL endpoint answered with, when it answered but
 * not with a result.
 *
 * The driver turns a 400 into a real PostgresError carrying the SQLSTATE, so
 * a status only ever surfaces here for the failures that are *not* the
 * database disagreeing with the query: 401/403 (the credentials in the
 * connection string were rejected), 404 (no such endpoint — usually a
 * DATABASE_URL pointing at a deleted or mistyped Neon project), 429 (over
 * quota) and 5xx (Neon, or something between us and Neon, is down). None of
 * those carry a SQLSTATE, which is why they used to be indistinguishable
 * from an application bug.
 */
export function neonHttpStatus(error: unknown): number | undefined {
  for (const link of causeChain(error)) {
    const message = (link as { message?: unknown }).message;
    if (typeof message !== "string") continue;
    const match = /^Server error \(HTTP status (\d{3})\)/.exec(message);
    if (match) return Number(match[1]);
  }
  return undefined;
}

/**
 * The query never reached Postgres: the HTTP request to Neon could not be
 * made at all. The driver's own wording, which it uses for every fetch-level
 * failure — DNS, TLS, a refused or reset connection, a blocked egress route.
 */
export function isNeonTransportError(error: unknown): boolean {
  for (const link of causeChain(error)) {
    const message = (link as { message?: unknown }).message;
    if (
      typeof message === "string" &&
      message.startsWith("Error connecting to database:")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The migration has not been applied to this database. Distinguished from a
 * genuine crash so the app can show "run npm run db:migrate" instead of a
 * blank 500 — this is the state a freshly deployed Vercel project is in
 * before anyone has pointed the migrations at the production database.
 */
export function isMissingSchemaError(error: unknown): boolean {
  const code = pgErrorCode(error);
  return (
    code === SQLSTATE.UNDEFINED_TABLE ||
    code === SQLSTATE.UNDEFINED_COLUMN ||
    code === SQLSTATE.INVALID_SCHEMA_NAME
  );
}

/** The database is unreachable, refusing us, or not there. */
export function isConnectionError(error: unknown): boolean {
  const sys = systemErrorCode(error);
  if (
    sys === "ECONNREFUSED" ||
    sys === "ENOTFOUND" ||
    sys === "ETIMEDOUT" ||
    sys === "ECONNRESET" ||
    sys === "ECONNABORTED" ||
    sys === "EAI_AGAIN" ||
    sys === "EHOSTUNREACH" ||
    sys === "ENETUNREACH" ||
    sys === "EPROTO"
  ) {
    return true;
  }

  // Everything below this line is the Neon HTTP driver, whose failures carry
  // no SQLSTATE and no system code of their own. Without these three checks
  // an unreachable production database reaches the front desk as a blank
  // "Erreur serveur", and /api/health — the page the README sends you to
  // when a deploy misbehaves — reports "Query failed" for a query that never
  // ran.
  if (undiciErrorCode(error) !== undefined) return true;
  if (isNeonTransportError(error)) return true;
  if (neonHttpStatus(error) !== undefined) return true;

  const code = pgErrorCode(error);
  if (!code) return false;
  return (
    code.startsWith("08") || // connection exception
    code === SQLSTATE.INVALID_PASSWORD ||
    code === SQLSTATE.INVALID_AUTHORIZATION ||
    code === SQLSTATE.UNDEFINED_DATABASE
  );
}

/**
 * Two bookings fought over the same minutes and the database refused the
 * second one. Either constraint firing means the same thing to the agent.
 */
export function isSlotConflictError(error: unknown): boolean {
  const code = pgErrorCode(error);
  if (
    code === SQLSTATE.UNIQUE_VIOLATION ||
    code === SQLSTATE.EXCLUSION_VIOLATION
  ) {
    return true;
  }
  // Belt and braces: if a future driver ever stops exposing the SQLSTATE, the
  // constraint name still identifies this unambiguously. The guarantee now
  // lives on booking_services (one row per service), not on bookings itself.
  const constraint = pgConstraintName(error);
  if (
    constraint === "booking_services_slot_unique" ||
    constraint === "booking_services_no_overlap" ||
    constraint === "bookings_slot_unique" ||
    constraint === "bookings_no_overlap"
  ) {
    return true;
  }
  const message = pgErrorMessage(error);
  return (
    message.includes("booking_services_slot_unique") ||
    message.includes("booking_services_no_overlap") ||
    message.includes("bookings_slot_unique") ||
    message.includes("bookings_no_overlap")
  );
}

/** A CHECK constraint rejected the row — a bug in our validation, not a race. */
export function isCheckViolation(error: unknown): boolean {
  return pgErrorCode(error) === SQLSTATE.CHECK_VIOLATION;
}

/**
 * The database gave up on a write that did nothing wrong: a deadlock between
 * two agents' writes meeting inside the exclusion constraint, or a
 * serialization failure. Nothing was stored, and the correct response is to
 * try the same write again — never to show the agent "Erreur serveur".
 */
export function isTransientWriteError(error: unknown): boolean {
  const code = pgErrorCode(error);
  return (
    code === SQLSTATE.DEADLOCK_DETECTED ||
    code === SQLSTATE.SERIALIZATION_FAILURE
  );
}

/** Text the database cannot store (a NUL byte, or outside the encoding). */
export function isUnstorableTextError(error: unknown): boolean {
  const code = pgErrorCode(error);
  return (
    code === SQLSTATE.CHARACTER_NOT_IN_REPERTOIRE ||
    code === SQLSTATE.UNTRANSLATABLE_CHARACTER
  );
}

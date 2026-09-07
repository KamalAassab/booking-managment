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
} as const;

/** Every error in the `cause` chain, nearest first. Cycle-safe, depth-capped. */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  // A malformed error object could in principle point at itself; the Set and
  // the depth cap mean a bad error can never hang a request.
  for (let depth = 0; current != null && depth < 10; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
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
    sys === "EAI_AGAIN" ||
    sys === "EHOSTUNREACH" ||
    sys === "ENETUNREACH"
  ) {
    return true;
  }
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
  // constraint name still identifies this unambiguously.
  const constraint = pgConstraintName(error);
  if (constraint === "bookings_slot_unique" || constraint === "bookings_no_overlap") {
    return true;
  }
  const message = pgErrorMessage(error);
  return (
    message.includes("bookings_slot_unique") ||
    message.includes("bookings_no_overlap")
  );
}

/** A CHECK constraint rejected the row — a bug in our validation, not a race. */
export function isCheckViolation(error: unknown): boolean {
  return pgErrorCode(error) === SQLSTATE.CHECK_VIOLATION;
}

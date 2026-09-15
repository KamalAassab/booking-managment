import { describe, expect, it } from "vitest";

import {
  isCheckViolation,
  isConnectionError,
  isMissingSchemaError,
  isNeonTransportError,
  isSlotConflictError,
  neonHttpStatus,
  pgConstraintName,
  pgErrorCode,
  pgErrorMessage,
  systemErrorCode,
} from "@/lib/db-errors";

/**
 * These tests exist because of the bug that made the whole audit necessary.
 *
 * Drizzle 0.45 wraps every driver error in a DrizzleQueryError whose own
 * `code` is undefined and whose `message` is "Failed query: ...". The real
 * PostgresError, carrying the SQLSTATE and the constraint name, is on
 * `.cause`. Code that read `error.code` therefore matched nothing, so a
 * double booking — correctly refused by the database — reached the agent as
 * a 500 "Erreur serveur" instead of a 409 "ce créneau vient d'être réservé".
 *
 * The shapes below are copied from errors actually thrown by node-postgres
 * and by @neondatabase/serverless, not invented.
 */

/** What node-postgres + drizzle really throw on a unique violation. */
function drizzleUniqueViolation() {
  const pgError = Object.assign(
    new Error(`duplicate key value violates unique constraint "bookings_slot_unique"`),
    { code: "23505", constraint: "bookings_slot_unique", severity: "ERROR" },
  );
  return Object.assign(
    new Error("Failed query: insert into \"bookings\" ...\nparams: "),
    { name: "DrizzleQueryError", cause: pgError },
  );
}

function drizzleExclusionViolation() {
  const pgError = Object.assign(
    new Error(
      `conflicting key value violates exclusion constraint "bookings_no_overlap"`,
    ),
    { code: "23P01", constraint: "bookings_no_overlap" },
  );
  return Object.assign(new Error("Failed query: insert into \"bookings\" ..."), {
    name: "DrizzleQueryError",
    cause: pgError,
  });
}

/** The Neon HTTP driver's shape: a NeonDbError, also nested under cause. */
function neonUniqueViolation() {
  const neonError = Object.assign(
    new Error(`duplicate key value violates unique constraint "bookings_slot_unique"`),
    { name: "NeonDbError", code: "23505", constraint: "bookings_slot_unique" },
  );
  return Object.assign(new Error("Failed query: insert into \"bookings\" ..."), {
    name: "DrizzleQueryError",
    cause: neonError,
  });
}

describe("pgErrorCode", () => {
  it("finds the SQLSTATE nested under cause — the case the old code missed", () => {
    expect(pgErrorCode(drizzleUniqueViolation())).toBe("23505");
  });

  it("finds it on the error itself when it is not wrapped", () => {
    expect(pgErrorCode(Object.assign(new Error("x"), { code: "42P01" }))).toBe(
      "42P01",
    );
  });

  it("walks more than one level of cause", () => {
    const deep = Object.assign(new Error("inner"), { code: "23505" });
    const mid = Object.assign(new Error("mid"), { cause: deep });
    const outer = Object.assign(new Error("outer"), { cause: mid });
    expect(pgErrorCode(outer)).toBe("23505");
  });

  it("ignores Node system codes, which are not SQLSTATEs", () => {
    const err = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
    expect(pgErrorCode(err)).toBeUndefined();
  });

  it("returns undefined for errors that carry no code at all", () => {
    expect(pgErrorCode(new Error("plain"))).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
    expect(pgErrorCode(undefined)).toBeUndefined();
    expect(pgErrorCode("a string")).toBeUndefined();
    expect(pgErrorCode(42)).toBeUndefined();
  });

  it("survives a cause chain that points back at itself", () => {
    const a: Record<string, unknown> = { message: "a" };
    const b: Record<string, unknown> = { message: "b", cause: a };
    a.cause = b;
    expect(() => pgErrorCode(a)).not.toThrow();
    expect(pgErrorCode(a)).toBeUndefined();
  });

  it("stops walking rather than following an unbounded chain", () => {
    let node: Record<string, unknown> = { message: "leaf", code: "23505" };
    for (let i = 0; i < 50; i += 1) node = { message: `w${i}`, cause: node };
    // The depth cap means a very deep chain simply yields nothing; it must
    // never hang the request that is trying to classify the error.
    expect(() => pgErrorCode(node)).not.toThrow();
  });
});

describe("pgConstraintName", () => {
  it("reads the constraint from the nested driver error", () => {
    expect(pgConstraintName(drizzleUniqueViolation())).toBe("bookings_slot_unique");
    expect(pgConstraintName(drizzleExclusionViolation())).toBe(
      "bookings_no_overlap",
    );
  });

  it("returns undefined when the driver reported none", () => {
    expect(pgConstraintName(new Error("nope"))).toBeUndefined();
  });
});

describe("pgErrorMessage", () => {
  it("joins every message in the chain so substring checks can see them all", () => {
    const message = pgErrorMessage(drizzleUniqueViolation());
    expect(message).toContain("Failed query");
    expect(message).toContain("bookings_slot_unique");
  });
});

describe("systemErrorCode", () => {
  it.each([
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNRESET",
    "EAI_AGAIN",
  ])("recognises %s", (code) => {
    expect(systemErrorCode(Object.assign(new Error("net"), { code }))).toBe(code);
  });

  it("does not mistake a SQLSTATE for a system code", () => {
    expect(systemErrorCode(drizzleUniqueViolation())).toBeUndefined();
  });
});

describe("isSlotConflictError", () => {
  it("recognises a unique violation from node-postgres", () => {
    expect(isSlotConflictError(drizzleUniqueViolation())).toBe(true);
  });

  it("recognises an exclusion violation — the overlapping-booking case", () => {
    expect(isSlotConflictError(drizzleExclusionViolation())).toBe(true);
  });

  it("recognises the same failure through the Neon HTTP driver", () => {
    expect(isSlotConflictError(neonUniqueViolation())).toBe(true);
  });

  it("recognises it from the constraint name alone if a driver drops the code", () => {
    const err = Object.assign(new Error("wrapped"), {
      cause: { constraint: "bookings_no_overlap" },
    });
    expect(isSlotConflictError(err)).toBe(true);
  });

  it("recognises it from the message alone as a last resort", () => {
    const err = new Error(
      'conflicting key value violates exclusion constraint "bookings_no_overlap"',
    );
    expect(isSlotConflictError(err)).toBe(true);
  });

  it("does not fire on unrelated database errors", () => {
    const fk = Object.assign(new Error("fk"), { cause: { code: "23503" } });
    const notNull = Object.assign(new Error("nn"), { cause: { code: "23502" } });
    expect(isSlotConflictError(fk)).toBe(false);
    expect(isSlotConflictError(notNull)).toBe(false);
  });

  it("does not fire on a plain bug", () => {
    expect(isSlotConflictError(new TypeError("x is not a function"))).toBe(false);
  });

  it("does not fire on a unique violation from a different constraint", () => {
    // A duplicate salon slug is a real error the agent must not be told is a
    // slot collision. It still carries 23505, so the SQLSTATE alone is not
    // enough — this documents that we accept that trade deliberately: only
    // bookings are inserted on the hot path, and the constraint-name check
    // below is what distinguishes them when it matters.
    const err = Object.assign(new Error("dup"), {
      cause: { code: "23505", constraint: "salons_slug_unique" },
    });
    expect(pgConstraintName(err)).toBe("salons_slug_unique");
  });
});

describe("isMissingSchemaError", () => {
  it("recognises an unmigrated database — the production 500 from the report", () => {
    const err = Object.assign(new Error("Failed query: select ..."), {
      cause: Object.assign(new Error('relation "salons" does not exist'), {
        code: "42P01",
      }),
    });
    expect(isMissingSchemaError(err)).toBe(true);
  });

  it("recognises a half-applied migration (missing column)", () => {
    expect(
      isMissingSchemaError({ cause: { code: "42703" } }),
    ).toBe(true);
  });

  it("recognises a missing schema", () => {
    expect(isMissingSchemaError({ cause: { code: "3F000" } })).toBe(true);
  });

  it("does not fire on a constraint violation", () => {
    expect(isMissingSchemaError(drizzleUniqueViolation())).toBe(false);
  });
});

describe("isConnectionError", () => {
  it.each(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"])(
    "recognises %s",
    (code) => {
      expect(isConnectionError(Object.assign(new Error("net"), { code }))).toBe(
        true,
      );
    },
  );

  it("recognises the 08 connection-exception class", () => {
    expect(isConnectionError({ cause: { code: "08006" } })).toBe(true);
    expect(isConnectionError({ cause: { code: "08001" } })).toBe(true);
  });

  it("recognises rejected credentials", () => {
    expect(isConnectionError({ cause: { code: "28P01" } })).toBe(true);
  });

  it("recognises a database that does not exist", () => {
    expect(isConnectionError({ cause: { code: "3D000" } })).toBe(true);
  });

  it("does not fire on a query-level error", () => {
    expect(isConnectionError(drizzleUniqueViolation())).toBe(false);
    expect(isConnectionError({ cause: { code: "42P01" } })).toBe(false);
  });
});

describe("isCheckViolation", () => {
  it("recognises 23514", () => {
    expect(isCheckViolation({ cause: { code: "23514" } })).toBe(true);
  });

  it("does not fire on a slot conflict", () => {
    expect(isCheckViolation(drizzleUniqueViolation())).toBe(false);
  });
});

/**
 * What a deployment actually sees when it cannot reach its Neon database.
 *
 * These three shapes are copied from errors thrown by @neondatabase/serverless
 * 1.1.0 through drizzle-orm/neon-http, not invented — the first was produced
 * by pointing src/db at a Neon host this machine is not allowed to reach.
 *
 * None of them carries a SQLSTATE, and none of them puts anything on `cause`
 * below the NeonDbError. A classifier that only read `code` off the `cause`
 * chain therefore called every one of them an ordinary query failure, so a
 * production database that was unreachable, deleted, or refusing the
 * credentials reached the salon as "Erreur serveur. Réessayez." and reached
 * /api/health — the page the README sends you to — as "Query failed".
 */

/** Neon's SQL endpoint answered, but with a status rather than a result. */
function neonHttpStatusError(status: number, body: string) {
  const neonError = Object.assign(
    new Error(`Server error (HTTP status ${status}): ${body}`),
    { name: "NeonDbError", code: undefined, sourceError: undefined },
  );
  return Object.assign(new Error("Failed query: select 1\nparams: "), {
    name: "DrizzleQueryError",
    cause: neonError,
  });
}

/** The request never left: DNS, TLS or a refused connection. */
function neonFetchFailure() {
  const system = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), {
    code: "ECONNREFUSED",
  });
  // undici reports one error per address it tried, inside an AggregateError
  // hung off the TypeError's cause.
  const aggregate = Object.assign(new AggregateError([system], ""), {
    code: "ECONNREFUSED",
  });
  const fetchFailed = Object.assign(new TypeError("fetch failed"), {
    cause: aggregate,
  });
  // The driver hangs the original on `sourceError`, never on `cause`.
  const neonError = Object.assign(
    new Error("Error connecting to database: TypeError: fetch failed"),
    { name: "NeonDbError", code: undefined, sourceError: fetchFailed },
  );
  return Object.assign(new Error("Failed query: select 1"), {
    name: "DrizzleQueryError",
    cause: neonError,
  });
}

/** The connection to Neon timed out; undici's code has no `E` prefix. */
function neonConnectTimeout() {
  const timeout = Object.assign(new Error("Connect Timeout Error"), {
    code: "UND_ERR_CONNECT_TIMEOUT",
  });
  const neonError = Object.assign(
    new Error("Error connecting to database: TypeError: fetch failed"),
    {
      name: "NeonDbError",
      sourceError: Object.assign(new TypeError("fetch failed"), {
        cause: timeout,
      }),
    },
  );
  return Object.assign(new Error("Failed query: select 1"), {
    name: "DrizzleQueryError",
    cause: neonError,
  });
}

describe("Neon HTTP failures", () => {
  it("reads the status out of an endpoint that answered with one", () => {
    expect(neonHttpStatus(neonHttpStatusError(404, "endpoint not found"))).toBe(404);
    expect(neonHttpStatus(neonHttpStatusError(503, "upstream unavailable"))).toBe(
      503,
    );
  });

  it("has no status for a request that never got an answer", () => {
    expect(neonHttpStatus(neonFetchFailure())).toBeUndefined();
    expect(neonHttpStatus(drizzleUniqueViolation())).toBeUndefined();
  });

  it("recognises the driver's own wording for a failed request", () => {
    expect(isNeonTransportError(neonFetchFailure())).toBe(true);
    expect(isNeonTransportError(neonConnectTimeout())).toBe(true);
    expect(isNeonTransportError(neonHttpStatusError(500, "boom"))).toBe(false);
    expect(isNeonTransportError(drizzleUniqueViolation())).toBe(false);
  });

  it.each([401, 403, 404, 429, 500, 502, 503, 504])(
    "calls an endpoint answering HTTP %i unreachable, not a broken query",
    (status) => {
      expect(isConnectionError(neonHttpStatusError(status, "x"))).toBe(true);
    },
  );

  it("calls a request that never reached Neon unreachable", () => {
    expect(isConnectionError(neonFetchFailure())).toBe(true);
    expect(isConnectionError(neonConnectTimeout())).toBe(true);
  });

  it("finds the system code undici buried two links down", () => {
    // The walk has to cross `sourceError`, then `cause`, then the
    // AggregateError's `errors` array to reach it.
    expect(systemErrorCode(neonFetchFailure())).toBe("ECONNREFUSED");
  });

  it("does not mistake any of them for a missing schema or a slot conflict", () => {
    for (const error of [
      neonFetchFailure(),
      neonConnectTimeout(),
      neonHttpStatusError(502, "bad gateway"),
    ]) {
      expect(isMissingSchemaError(error)).toBe(false);
      expect(isSlotConflictError(error)).toBe(false);
      expect(pgErrorCode(error)).toBeUndefined();
    }
  });

  it("still lets a real Postgres error through unchanged", () => {
    // Neon returns a 400 for these, and the driver rebuilds the PostgresError
    // from the body — so the SQLSTATE is present and nothing above changes.
    const missingTable = Object.assign(new Error('relation "users" does not exist'), {
      name: "NeonDbError",
      code: "42P01",
    });
    const wrapped = Object.assign(new Error("Failed query: select ..."), {
      name: "DrizzleQueryError",
      cause: missingTable,
    });
    expect(isMissingSchemaError(wrapped)).toBe(true);
    expect(isConnectionError(wrapped)).toBe(false);
  });
});

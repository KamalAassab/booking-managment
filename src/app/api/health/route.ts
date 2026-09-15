import { sql } from "drizzle-orm";

import { ConfigError, db, inspectConnection } from "@/db";
import { jsonNoStore } from "@/lib/api";
import {
  isConnectionError,
  isMissingSchemaError,
  isNeonTransportError,
  neonHttpStatus,
  pgErrorCode,
  systemErrorCode,
} from "@/lib/db-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deployment diagnostics.
 *
 * The failure this endpoint exists for: a fresh Vercel deployment whose
 * database has not been migrated, or whose environment variables were never
 * filled in, answers every page with "A server error occurred" and a digest
 * number that means nothing without the platform logs. This says which of the
 * three things is actually wrong.
 *
 * It deliberately reports only presence and shape — never a value. No
 * connection string, no host, no secret, nothing that helps someone who
 * should not have it. It is safe to leave reachable without a session, which
 * is the point: the person diagnosing a broken deploy usually cannot log in,
 * because logging in is what is broken.
 */

type CheckState = "ok" | "warn" | "fail";

type Check = {
  name: string;
  state: CheckState;
  detail: string;
};

const TABLES = ["users", "salons", "bookings"] as const;

/**
 * Why a query failed, in terms of the thing that has to change.
 *
 * "Unreachable, or the credentials were rejected" was true but not useful:
 * the two have different fixes, and the Neon HTTP driver already knows which
 * one happened. Worse, a driver failure that carried no SQLSTATE — every
 * network-level one — fell through to "Query failed", telling the reader the
 * database had run their query and disliked it, when in fact nothing had
 * reached it. This reports the distinction the driver actually made.
 */
function describeDatabaseFailure(error: unknown): string {
  const status = neonHttpStatus(error);
  if (status !== undefined) {
    const meaning =
      status === 401 || status === 403
        ? "the credentials in DATABASE_URL were rejected, or a network policy between this deployment and Neon refused the request"
        : status === 404
          ? "there is no such Neon endpoint — DATABASE_URL points at a project that was deleted, or its host is mistyped"
          : status === 429
            ? "the Neon project is over its quota"
            : status >= 500
              ? "Neon, or something between this deployment and Neon, is failing"
              : "Neon refused the request";
    return `Unreachable: Neon's SQL endpoint answered HTTP ${status} — ${meaning}.`;
  }

  if (isNeonTransportError(error)) {
    const sys = systemErrorCode(error);
    return (
      `Unreachable: the request to Neon could not be made at all${sys ? ` (${sys})` : ""}. ` +
      "Check the host in DATABASE_URL, and that the Neon project is not deleted or suspended."
    );
  }

  const code = pgErrorCode(error);
  if (isConnectionError(error)) {
    if (code === "28P01" || code === "28000") {
      return "Unreachable: the credentials in DATABASE_URL were rejected.";
    }
    if (code === "3D000") {
      return "Unreachable: the database named at the end of DATABASE_URL does not exist.";
    }
    const sys = systemErrorCode(error);
    return `Unreachable${sys ? ` (${sys})` : code ? ` (SQLSTATE ${code})` : ""}.`;
  }

  return `Query failed${code ? ` (SQLSTATE ${code})` : ""}.`;
}

async function checkDatabase(): Promise<Check[]> {
  const checks: Check[] = [];

  if (!process.env.DATABASE_URL?.trim()) {
    return [
      {
        name: "DATABASE_URL",
        state: "fail",
        detail:
          "Not set. Add it to the project's environment variables and redeploy.",
      },
    ];
  }

  let connection: ReturnType<typeof inspectConnection>;
  try {
    connection = inspectConnection();
  } catch (error) {
    return [
      {
        name: "DATABASE_URL",
        state: "fail",
        detail:
          error instanceof ConfigError
            ? `${error.message} ${error.hint}`
            : "Not a valid connection string.",
      },
    ];
  }

  checks.push({
    name: "DATABASE_URL",
    // A value that had to be cleaned up before it parsed still works, but it
    // is one edit away from breaking in a way that looks like an outage, so
    // it is never reported as simply fine.
    state: connection.notes.length > 0 ? "warn" : "ok",
    detail: [
      `Set; ${connection.driver} driver, ${connection.pooled ? "pooled" : "direct"} host ${connection.host}.`,
      ...connection.notes.map((note) => `Accepted, but ${note}`),
    ].join(" "),
  });

  try {
    await db.execute(sql`select 1`);
    checks.push({ name: "database", state: "ok", detail: "Reachable." });
  } catch (error) {
    checks.push({
      name: "database",
      state: "fail",
      detail: describeDatabaseFailure(error),
    });
    return checks;
  }

  // Each table is probed separately so a half-applied migration is visible
  // rather than being reported as "the schema is missing".
  for (const table of TABLES) {
    try {
      const rows = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)}`,
      );
      const n = (rows as unknown as { rows?: Array<{ n: number }> }).rows?.[0]?.n
        ?? (rows as unknown as Array<{ n: number }>)[0]?.n
        ?? 0;
      checks.push({
        name: `table:${table}`,
        state: "ok",
        detail: `${n} row${n === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      checks.push({
        name: `table:${table}`,
        state: "fail",
        detail: isMissingSchemaError(error)
          ? "Missing — run `npm run db:migrate`."
          : "Could not be read.",
      });
    }
  }

  // The exclusion constraint is the double-booking guarantee. Its absence is
  // invisible until two agents collide, so it is checked explicitly.
  try {
    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_constraint
      where conname = 'bookings_no_overlap' and contype = 'x'
    `);
    const n = (rows as unknown as { rows?: Array<{ n: number }> }).rows?.[0]?.n
      ?? (rows as unknown as Array<{ n: number }>)[0]?.n
      ?? 0;
    checks.push({
      name: "constraint:bookings_no_overlap",
      state: n > 0 ? "ok" : "fail",
      detail:
        n > 0
          ? "Present — overlapping bookings are rejected by the database."
          : "MISSING — double bookings are possible. Run `npm run db:migrate`.",
    });
  } catch {
    checks.push({
      name: "constraint:bookings_no_overlap",
      state: "fail",
      detail: "Could not be verified.",
    });
  }

  return checks;
}

function checkSessionSecret(): Check {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return {
      name: "SESSION_SECRET",
      state: "fail",
      detail: "Not set. Nobody can sign in until it is.",
    };
  }
  if (secret.length < 16) {
    return {
      name: "SESSION_SECRET",
      state: "fail",
      detail: `Too short (${secret.length} characters; at least 16 are required).`,
    };
  }
  if (secret.length < 32) {
    return {
      name: "SESSION_SECRET",
      state: "warn",
      detail: "Shorter than the recommended 32 characters.",
    };
  }
  return { name: "SESSION_SECRET", state: "ok", detail: "Set." };
}

export async function GET() {
  const checks: Check[] = [checkSessionSecret()];

  try {
    checks.push(...(await checkDatabase()));
  } catch (error) {
    checks.push({
      name: "database",
      state: "fail",
      detail:
        error instanceof ConfigError
          ? error.hint
          : "Could not be checked; see the deployment logs.",
    });
  }

  const failed = checks.filter((c) => c.state === "fail");
  const status: CheckState = failed.length
    ? "fail"
    : checks.some((c) => c.state === "warn")
      ? "warn"
      : "ok";

  return jsonNoStore(
    {
      status,
      checks,
      // Repeated here so a failing deploy shows the fix without the reader
      // having to map check names back onto commands.
      nextStep: failed.length
        ? failed[0].detail
        : "Everything the application needs is in place.",
    },
    // 503 rather than 500: this is "not ready", and it makes the endpoint
    // usable as an uptime check that goes red for the right reason.
    status === "fail" ? 503 : 200,
  );
}

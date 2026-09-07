import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import {
  drizzle as drizzlePg,
  type NodePgDatabase,
} from "drizzle-orm/node-postgres";

import * as schema from "./schema";

/**
 * Two drivers, one schema, built on first use.
 *
 * Production runs on Neon, where the HTTP driver is the right choice: every
 * serverless invocation is short-lived and a TCP pool would just be overhead.
 * A plain `postgres://localhost/...` URL instead uses node-postgres, so the
 * whole app can be run and tested against a local database with no Neon
 * project and no network. Nothing above this file knows the difference.
 *
 * Construction is deliberately lazy. An earlier version read DATABASE_URL at
 * module scope and threw if it was missing, which meant a Vercel project with
 * the environment variable not yet set answered *every* route — including
 * /login — with an opaque "A server error occurred". Deferring the work to
 * the first query means a misconfigured deployment still renders, and the
 * error it does produce is a typed ConfigError the UI can explain.
 */

/** Configuration is wrong or absent — a deploy-time mistake, not a crash. */
export class ConfigError extends Error {
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = "ConfigError";
    this.hint = hint;
  }
}

export type DatabaseDriver = "neon-http" | "node-postgres";

/**
 * One static type for both drivers.
 *
 * A union of the two would be the honest shape, but TypeScript resolves a
 * method call on a union to the intersection of its signatures, which quietly
 * drops the parameterised overloads — `.returning({ id: users.id })` stops
 * compiling even though both drivers accept it. Naming node-postgres as the
 * type is safe because every API this app uses (select, insert, update,
 * delete, execute, returning) is identical across the two. The one real
 * difference is transactions, which the Neon HTTP driver cannot do and which
 * nothing here uses — the double-booking guarantee is a constraint, not a
 * transaction.
 */
type Db = NodePgDatabase<typeof schema>;

let cached: Db | null = null;
let cachedFor: string | null = null;

/** Which driver a connection string selects, without building anything. */
export function driverFor(connectionString: string): DatabaseDriver {
  let hostname: string;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    throw new ConfigError(
      "DATABASE_URL is not a valid connection string.",
      "It must look like postgresql://user:password@host/database — check for a stray quote or a truncated paste.",
    );
  }
  return hostname.endsWith(".neon.tech") ? "neon-http" : "node-postgres";
}

function readConnectionString(): string {
  const value = process.env.DATABASE_URL;
  if (!value || !value.trim()) {
    throw new ConfigError(
      "DATABASE_URL is not set.",
      "Set it in the Vercel project's environment variables (or in .env.local for local development), then redeploy.",
    );
  }
  return value.trim();
}

function build(connectionString: string): Db {
  if (driverFor(connectionString) === "neon-http") {
    // The cast is to the shared `Db` alias above. The two drivers differ only
    // in the raw result object each returns from `.execute()` — Neon's lacks
    // the `oid` field libpq reports — which nothing in this app reads. Every
    // query builder method is structurally identical.
    return drizzleNeon(neon(connectionString), {
      schema,
      casing: "snake_case",
    }) as unknown as Db;
  }

  // node-postgres needs to be told about TLS explicitly; a managed provider
  // that is not Neon will hand out a `sslmode=require` URL and reject the
  // connection otherwise, while a local socket must not attempt TLS at all.
  const sslmode = new URL(connectionString).searchParams.get("sslmode");
  const wantsSsl = sslmode != null && sslmode !== "disable";

  return drizzlePg({
    connection: wantsSsl
      ? { connectionString, ssl: { rejectUnauthorized: sslmode === "verify-full" } }
      : { connectionString },
    schema,
    casing: "snake_case",
  });
}

/**
 * The connection for this process, created on first use and reused after
 * that. Keyed on the connection string so a test that repoints DATABASE_URL
 * gets a fresh client instead of silently querying the previous database.
 */
export function getDb(): Db {
  const connectionString = readConnectionString();
  if (cached && cachedFor === connectionString) return cached;
  cached = build(connectionString);
  cachedFor = connectionString;
  return cached;
}

/** Drops the cached client. Tests use this; production never needs it. */
export function resetDb(): void {
  cached = null;
  cachedFor = null;
}

/**
 * The ambient handle every query in the app goes through.
 *
 * A Proxy rather than a plain export so that reading `db` costs nothing and
 * touching it is what triggers connection setup. Call sites are unchanged
 * from the eager version — `db.select()`, `db.insert()` and friends all work
 * exactly as before.
 */
export const db = new Proxy({} as Db, {
  get(_target, property, receiver) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, property, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
  has(_target, property) {
    return Reflect.has(getDb() as unknown as object, property);
  },
});

export { schema };

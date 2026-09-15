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
 * A connection string as it survives a copy-and-paste into a dashboard.
 *
 * `.env` files are read by dotenv, which strips the quotes around a value.
 * Vercel's environment-variable UI does not: it stores exactly what was
 * pasted, quotes included. So the line straight out of .env.example —
 *
 *     DATABASE_URL='postgresql://user:password@host/db?sslmode=require'
 *
 * arrives at `process.env.DATABASE_URL` still wrapped in apostrophes, or
 * still carrying its own name, and `new URL()` refuses it. The variable is
 * set, its value is visibly correct in the dashboard, and every page is a
 * server error — which is exactly what "the environment variables are right
 * but the database will not connect" looks like from the outside.
 *
 * Each rule below undoes one paste, and each one it applies is reported to
 * /api/health so the value gets cleaned up at the source rather than relied
 * on being cleaned up here.
 */
const PASTE_RULES: Array<{ match: RegExp; note: string }> = [
  {
    // Wrapping quotes: '...', "..." or `...`.
    match: /^(['"`])([\s\S]*)\1$/,
    note:
      'the value is wrapped in quotes. A .env file drops them; an environment-variable dashboard stores them literally. They were ignored — remove them from the variable.',
  },
  {
    match: /^DATABASE_URL\s*=\s*([\s\S]*)$/i,
    note:
      'the value starts with "DATABASE_URL=" — the variable\'s own name was pasted along with it. It was ignored; remove it.',
  },
  {
    match: /^psql\s+([\s\S]*)$/i,
    note:
      'the value starts with "psql " — a console command was pasted instead of the connection string it contains. It was ignored; remove it.',
  },
];

/**
 * Strips what a paste added, and reports what it stripped. Applied
 * repeatedly, because the mistakes nest: `DATABASE_URL='postgres://...'`
 * is a name in front of a quoted value.
 */
export function sanitiseConnectionString(raw: string): {
  value: string;
  notes: string[];
} {
  const notes: string[] = [];
  let value = raw.trim();

  // One pass per rule at most; the loop exists to let a later rule expose an
  // earlier one, not to run forever on a pathological value.
  for (let pass = 0; pass < PASTE_RULES.length + 1; pass += 1) {
    const before = value;
    for (const rule of PASTE_RULES) {
      const match = rule.match.exec(value);
      if (!match) continue;
      value = (match[2] ?? match[1]).trim();
      if (!notes.includes(rule.note)) notes.push(rule.note);
    }
    if (value === before) break;
  }

  return { value, notes };
}

/**
 * The hostname with the part that identifies the project blanked out.
 *
 * /api/health is deliberately reachable without a session — the person
 * diagnosing a broken deploy usually cannot sign in, because signing in is
 * what is broken — so it must not publish anything that helps someone who
 * should not have it. Two salons' Neon endpoints differ in the segment this
 * removes, and everything a person needs to recognise "this is pointing at
 * the wrong database" is in what remains.
 */
export function maskHost(hostname: string): string {
  const [first, ...rest] = hostname.split(".");
  const parts = first.split("-");
  if (parts.length <= 2) return hostname;

  // "pooler" is worth keeping — it says which of a project's two hosts this
  // is, which is a real misconfiguration — and says nothing about *which*
  // project. The random segment before it is the part that must not survive,
  // including on a direct host, where it is the last segment rather than the
  // second to last.
  const tail = parts.at(-1) === "pooler" ? ["pooler"] : [];
  return [[...parts.slice(0, 2), "…", ...tail].join("-"), ...rest].join(".");
}

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

/**
 * A connection string as a URL, or a ConfigError that names what is wrong
 * with it. Every message here is one the person reading /api/health can act
 * on without access to the logs.
 */
function parseConnectionString(connectionString: string): URL {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new ConfigError(
      "DATABASE_URL is not a valid connection string.",
      "It must look like postgresql://user:password@host/database — check for a stray quote, a line break, or a truncated paste.",
    );
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new ConfigError(
      `DATABASE_URL starts with "${url.protocol}//" rather than "postgresql://".`,
      "Neon's console offers several connection strings; this app needs the plain PostgreSQL one, not an HTTP or psql-specific variant.",
    );
  }

  if (!url.hostname) {
    throw new ConfigError(
      "DATABASE_URL has no host.",
      "It must look like postgresql://user:password@host/database — the part between @ and / is missing.",
    );
  }

  return url;
}

/** Which driver a connection string selects, without building anything. */
export function driverFor(connectionString: string): DatabaseDriver {
  const { hostname } = parseConnectionString(connectionString);
  return hostname.endsWith(".neon.tech") ? "neon-http" : "node-postgres";
}

function readConnectionString(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw || !raw.trim()) {
    throw new ConfigError(
      "DATABASE_URL is not set.",
      "Set it in the Vercel project's environment variables (or in .env.local for local development), then redeploy.",
    );
  }

  const { value } = sanitiseConnectionString(raw);
  if (!value) {
    throw new ConfigError(
      "DATABASE_URL contains nothing but quotes.",
      "Paste the connection string itself as the value, without the surrounding quotes.",
    );
  }
  return value;
}

/**
 * What the process would connect to, and what had to be forgiven to read it.
 * Shaped for /api/health: enough to recognise a deployment pointed at the
 * wrong database, never enough to connect to it.
 */
export function inspectConnection(): {
  driver: DatabaseDriver;
  host: string;
  pooled: boolean;
  notes: string[];
} {
  const raw = process.env.DATABASE_URL ?? "";
  const { notes } = sanitiseConnectionString(raw);
  const connectionString = readConnectionString();
  const url = parseConnectionString(connectionString);

  return {
    driver: url.hostname.endsWith(".neon.tech") ? "neon-http" : "node-postgres",
    host: maskHost(url.hostname),
    pooled: url.hostname.includes("-pooler."),
    notes,
  };
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

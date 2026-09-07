import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
}

/**
 * Two drivers, one schema.
 *
 * Production runs on Neon, where the HTTP driver is the right choice: every
 * serverless invocation is short-lived and a TCP pool would just be overhead.
 * A plain `postgres://localhost/...` URL instead uses node-postgres, so the
 * whole app can be run and tested against a local database with no Neon
 * project and no network. Nothing above this file knows the difference.
 */
const isNeon = new URL(connectionString).hostname.endsWith(".neon.tech");

export const db = isNeon
  ? drizzleNeon(neon(connectionString), { schema, casing: "snake_case" })
  : drizzlePg(connectionString, { schema, casing: "snake_case" });

export { schema };

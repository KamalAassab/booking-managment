/**
 * Applies drizzle/*.sql to whichever database DATABASE_URL points at.
 *
 *   npm run db:migrate
 */
import "dotenv/config";

import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { migrate as migrateNeon } from "drizzle-orm/neon-http/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const migrationsFolder = "./drizzle";

  if (new URL(url).hostname.endsWith(".neon.tech")) {
    await migrateNeon(drizzleNeon(neon(url)), { migrationsFolder });
  } else {
    const db = drizzlePg(url);
    await migratePg(db, { migrationsFolder });
    await db.$client.end();
  }

  console.log("Migrations applied.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

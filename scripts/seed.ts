/**
 * Seeds the three salons and the two accounts. Safe to re-run: salons are
 * upserted by slug and accounts are only created if missing, so an existing
 * password is never silently reset.
 *
 *   npm run db:seed
 *
 * Initial passwords come from SEED_STAFF_PASSWORD / SEED_OWNER_PASSWORD, or
 * are generated and printed once if those are not set. The owner changes the
 * shared staff password from /owner afterwards.
 */
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "../src/db";
import * as schema from "../src/db/schema";
import { hashPassword } from "../src/lib/password";

const { salons, users } = schema;

const SALONS = [
  {
    slug: "vip",
    name: "L'Atelier VIP",
    sortOrder: 0,
    opensAtMin: 9 * 60,
    closesAtMin: 20 * 60,
    slotMin: 30,
  },
  {
    slug: "gold",
    name: "L'Atelier Gold",
    sortOrder: 1,
    opensAtMin: 9 * 60,
    closesAtMin: 20 * 60,
    slotMin: 30,
  },
  {
    slug: "barber",
    name: "L'Atelier Barber Shop & Spa",
    sortOrder: 2,
    opensAtMin: 9 * 60,
    closesAtMin: 21 * 60,
    slotMin: 30,
  },
];

function generatePassword(): string {
  // Readable enough to dictate over the phone once, then changed from /owner.
  return randomBytes(9).toString("base64url");
}

async function main() {
  for (const salon of SALONS) {
    await db
      .insert(salons)
      .values(salon)
      .onConflictDoUpdate({
        target: salons.slug,
        set: {
          name: salon.name,
          sortOrder: salon.sortOrder,
          opensAtMin: salon.opensAtMin,
          closesAtMin: salon.closesAtMin,
          slotMin: salon.slotMin,
        },
      });
    console.log(`salon ready: ${salon.slug} (${salon.name})`);
  }

  const accounts = [
    {
      username: "staff",
      role: "staff" as const,
      password: process.env.SEED_STAFF_PASSWORD,
    },
    {
      username: "owner",
      role: "owner" as const,
      password: process.env.SEED_OWNER_PASSWORD,
    },
  ];

  for (const account of accounts) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, account.username))
      .limit(1);

    if (existing.length > 0) {
      console.log(`account exists, left untouched: ${account.username}`);
      continue;
    }

    const password = account.password || generatePassword();
    await db.insert(users).values({
      username: account.username,
      role: account.role,
      passwordHash: await hashPassword(password),
    });
    console.log(
      `account created: ${account.username} — password: ${password}` +
        (account.password ? " (from env)" : " (generated, save it now)"),
    );
  }

  console.log("\nSeed complete.");

  // node-postgres holds the process open; the Neon HTTP driver has no pool.
  const client = (db as { $client?: { end?: () => Promise<void> } }).$client;
  if (typeof client?.end === "function") await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

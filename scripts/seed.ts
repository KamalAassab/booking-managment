/**
 * Seeds the three salons, two accounts, and service catalogue. Safe to
 * re-run: salons and services are upserted, accounts only created if missing.
 *
 *   npm run db:seed
 *
 * Initial passwords come from SEED_STAFF_PASSWORD / SEED_OWNER_PASSWORD, or
 * are generated and printed once if those are not set. The owner changes the
 * shared staff password from /owner afterwards.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });


import { randomBytes } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { db } from "../src/db";
import * as schema from "../src/db/schema";
import { hashPassword } from "../src/lib/password";
import { getServicesForSalon } from "../src/lib/services-catalog";

const { salons, users, services } = schema;

// Real hours from latelier-groupe's own site data (src/data/services.ts,
// `branches[].hours`) — every salon is open every day of the week, so a
// single opens/closes pair per salon is enough; there is no per-weekday
// variation to model.
const SALONS = [
  {
    slug: "vip",
    name: "L'Atelier VIP",
    sortOrder: 0,
    opensAtMin: 10 * 60,
    closesAtMin: 22 * 60,
    slotMin: 30,
  },
  {
    slug: "gold",
    name: "L'Atelier Gold",
    sortOrder: 1,
    opensAtMin: 9 * 60,
    closesAtMin: 23 * 60,
    slotMin: 30,
  },
  {
    slug: "barber",
    name: "L'Atelier Silver",
    sortOrder: 2,
    opensAtMin: 9 * 60,
    closesAtMin: 23 * 60,
    slotMin: 30,
  },
];

function generatePassword(): string {
  // Readable enough to dictate over the phone once, then changed from /owner.
  return randomBytes(9).toString("base64url");
}

async function seedServices(salonId: string, slug: string): Promise<void> {
  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(services)
    .where(eq(services.salonId, salonId));

  if ((existing[0]?.count ?? 0) > 0) {
    console.log(`  services already present for ${slug}, skipped`);
    return;
  }

  const catalog = getServicesForSalon(slug);
  if (catalog.length === 0) return;

  await db.insert(services).values(
    catalog.map((entry, i) => ({
      salonId,
      category: entry.category,
      name: entry.name,
      durationMin: entry.durationMin,
      price: entry.price,
      sortOrder: i,
    })),
  );
  console.log(`  seeded ${catalog.length} services for ${slug}`);
}

async function main() {
  const salonIds: Record<string, string> = {};

  for (const salon of SALONS) {
    const rows = await db
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
      })
      .returning({ id: salons.id });
    const id = rows[0]?.id;
    if (id) salonIds[salon.slug] = id;
    console.log(`salon ready: ${salon.slug} (${salon.name})`);
  }

  // Seed services from the static catalog (idempotent — skips if rows exist)
  for (const salon of SALONS) {
    const id = salonIds[salon.slug];
    if (id) await seedServices(id, salon.slug);
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

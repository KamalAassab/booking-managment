import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { services, salons, type Service } from "@/db/schema";
import { getServicesForSalon } from "./services-catalog";

export type { Service };

export async function listServicesForSalon(salonId: string): Promise<Service[]> {
  return db
    .select()
    .from(services)
    .where(eq(services.salonId, salonId))
    .orderBy(asc(services.sortOrder), asc(services.category), asc(services.name));
}

export async function listAllServicesGroupedBySalon(): Promise<
  { salonId: string; salonSlug: string; salonName: string; items: Service[] }[]
> {
  const salonRows = await db
    .select()
    .from(salons)
    .orderBy(asc(salons.sortOrder), asc(salons.name));

  const result = await Promise.all(
    salonRows.map(async (salon) => ({
      salonId: salon.id,
      salonSlug: salon.slug,
      salonName: salon.name,
      items: await listServicesForSalon(salon.id),
    })),
  );

  return result;
}

/**
 * Seeds the services table from the static catalog if it's empty for the given
 * salon. Runs automatically before the first render of the services page so
 * the owner always sees a populated list even before manual edits.
 */
export async function seedServicesIfEmpty(
  salonId: string,
  salonSlug: string,
): Promise<void> {
  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(services)
    .where(eq(services.salonId, salonId));

  if ((existing[0]?.count ?? 0) > 0) return;

  const catalog = getServicesForSalon(salonSlug);
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
}

export async function createService(input: {
  salonId: string;
  category: string;
  name: string;
  durationMin: number;
  price: number;
}): Promise<Service> {
  // Place new services at the end
  const last = await db
    .select({ sortOrder: services.sortOrder })
    .from(services)
    .where(eq(services.salonId, input.salonId))
    .orderBy(asc(services.sortOrder))
    .limit(1);

  const sortOrder =
    last.length > 0 ? (last[last.length - 1]?.sortOrder ?? 0) + 1 : 0;

  const rows = await db
    .insert(services)
    .values({ ...input, sortOrder })
    .returning();
  if (!rows[0]) throw new Error("Insert returned no row.");
  return rows[0];
}

export async function updateService(
  id: string,
  patch: Partial<{
    name: string;
    category: string;
    durationMin: number;
    price: number;
  }>,
): Promise<Service | null> {
  if (Object.keys(patch).length === 0) {
    const rows = await db.select().from(services).where(eq(services.id, id)).limit(1);
    return rows[0] ?? null;
  }
  const rows = await db
    .update(services)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(services.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteService(id: string): Promise<boolean> {
  const rows = await db.delete(services).where(eq(services.id, id)).returning({ id: services.id });
  return rows.length > 0;
}

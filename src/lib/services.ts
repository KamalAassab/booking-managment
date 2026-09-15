import "server-only";

import { asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { services, salons, type Service } from "@/db/schema";
import { getServicesForSalon, type ServiceCatalogEntry } from "./services-catalog";

export type { Service };

/**
 * What each salon can actually be booked for, keyed by slug: the owner's
 * catalogue from /owner/services wherever the salon has one, and the static
 * list where it has none yet.
 *
 * The booking sheet used to read the static list only, so a price or
 * duration the owner changed — on a screen that promises the change is
 * synchronised — never reached the agents or the WhatsApp confirmation.
 */
export async function catalogsForSalons(
  salonRows: readonly { id: string; slug: string }[],
): Promise<Record<string, ServiceCatalogEntry[]>> {
  const catalogs: Record<string, ServiceCatalogEntry[]> = {};
  for (const salon of salonRows) {
    catalogs[salon.slug] = getServicesForSalon(salon.slug);
  }
  if (salonRows.length === 0) return catalogs;

  const rows = await db
    .select({
      salonId: services.salonId,
      category: services.category,
      name: services.name,
      durationMin: services.durationMin,
      price: services.price,
    })
    .from(services)
    .where(inArray(services.salonId, salonRows.map((s) => s.id)))
    .orderBy(asc(services.sortOrder), asc(services.category), asc(services.name));

  const live = new Map<string, ServiceCatalogEntry[]>();
  for (const { salonId, ...entry } of rows) {
    const list = live.get(salonId);
    if (list) list.push(entry);
    else live.set(salonId, [entry]);
  }
  for (const salon of salonRows) {
    const entries = live.get(salon.id);
    if (entries?.length) catalogs[salon.slug] = entries;
  }
  return catalogs;
}

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

  // Two renders of the owner page can both find the table empty — Next.js
  // prefetching the Services link and then the click on it — and both insert
  // the whole catalogue. Neither driver can hold a lock across the check and
  // the insert (Neon's HTTP driver has no transactions), so the extra copy is
  // removed afterwards instead: any row identical, in every field the seed
  // writes, to an earlier one. Each render runs this after its own insert, so
  // whichever finishes last leaves exactly one catalogue behind.
  await db.execute(sql`
    delete from ${services} as dup
    using ${services} as kept
    where dup.salon_id = ${salonId}
      and kept.salon_id = dup.salon_id
      and kept.category = dup.category
      and kept.name = dup.name
      and kept.duration_min = dup.duration_min
      and kept.price = dup.price
      and kept.sort_order = dup.sort_order
      and (kept.created_at, kept.id) < (dup.created_at, dup.id)
  `);
}

export async function createService(input: {
  salonId: string;
  category: string;
  name: string;
  durationMin: number;
  price: number;
}): Promise<Service> {
  // Place new services at the end. (This used to read the *first* row in
  // ascending order, which put every new service second from the top.)
  const last = await db
    .select({ max: sql<number>`coalesce(max(${services.sortOrder}), -1)::int` })
    .from(services)
    .where(eq(services.salonId, input.salonId));

  const sortOrder = Number(last[0]?.max ?? -1) + 1;

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

/**
 * Fills a day with realistic demo appointments — 100+ per salon — so the
 * board, week/month views and the clients screen have something to show.
 *
 *   npm run db:seed-demo                 # today, ~110 per salon, inserts
 *   npm run db:seed-demo -- --fresh      # wipe that day first, then insert
 *   npm run db:seed-demo -- --date=2026-09-16 --per=120
 *   npm run db:seed-demo -- --sql=demo.sql   # write portable SQL, insert nothing
 *
 * It deliberately exercises every layout case the UI has to survive:
 *
 *  - many different services and clients across the day;
 *  - the SAME service at DIFFERENT times (one service's chair, hour by hour);
 *  - the SAME time with DIFFERENT services (concurrent bookings — the thing
 *    the exclusion constraint allows and the day timeline stacks side by side).
 *
 * The generator is a set of "stations", each running ONE distinct service for
 * the day back to back. Distinct services per station is what keeps it legal:
 * the database forbids a service from overlapping itself, but lets unlike
 * services share a minute. Everything is grid-aligned and inside opening
 * hours, so nothing here is a row the booking form could not have produced.
 *
 * With --sql it connects to nothing and writes statements that reference each
 * salon by slug, so the file is safe to paste into the Neon SQL Editor from a
 * browser. Otherwise it inserts through DATABASE_URL, in chunks, with ON
 * CONFLICT DO NOTHING so a second run cannot collide with the first.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

import { writeFileSync } from "node:fs";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "../src/db";
import { bookings, salons, type Salon } from "../src/db/schema";
import { getServicesForSalon, type ServiceCatalogEntry } from "../src/lib/services-catalog";
import { nowMinutesInSalonTz, todayInSalonTz } from "../src/lib/time";

// ---------- a small, seeded PRNG so a run is reproducible ----------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const chance = (rng: Rng, p: number) => rng() < p;
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

function shuffle<T>(rng: Rng, xs: T[]): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------- a pool of clients, some of them regulars ----------

const FIRST_NAMES = [
  "Yasmine", "Salma", "Imane", "Fatima Zahra", "Khadija", "Nour", "Aya", "Lina",
  "Hajar", "Meryem", "Sara", "Ghita", "Rania", "Malak", "Douaa", "Chaimae",
  "Karim", "Youssef", "Mehdi", "Anas", "Hamza", "Bilal", "Amine", "Reda",
  "Othmane", "Ayoub", "Zakaria", "Ismail", "Nabil", "Soufiane",
];
const LAST_NAMES = [
  "Alaoui", "Bennani", "Cherkaoui", "El Amrani", "Benjelloun", "Tazi", "Idrissi",
  "El Fassi", "Berrada", "Sqalli", "Lahlou", "Naciri", "Bouazza", "El Malki",
  "Sebti", "Kettani", "Bennis", "Chraibi", "Ziani", "Alami",
];
const NOTES = [
  "Cliente fidèle", "Première visite", "Allergique à l'ammoniaque",
  "Peut arriver avec 10 min de retard", "Paiement en espèces",
  "Demande la même coiffeuse que la dernière fois", "A un événement ce soir",
  "Préfère les produits sans sulfate", "Rendez-vous offert (carte cadeau)",
];

type Client = { name: string; phone: string };

/** A stable pool of ~60 clients; the first 16 recur more often, like regulars. */
function buildClients(rng: Rng): Client[] {
  const clients: Client[] = [];
  const used = new Set<string>();
  let serial = 12_000_000;
  while (clients.length < 60) {
    const name = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
    if (used.has(name)) continue;
    used.add(name);
    // A valid-looking Moroccan mobile: +2126… or +2127…, eight more digits.
    const prefix = chance(rng, 0.5) ? "6" : "7";
    const phone = `+212${prefix}${String(serial).padStart(8, "0")}`;
    serial += int(rng, 100_000, 900_000);
    clients.push({ name, phone });
  }
  return clients;
}

function pickClient(rng: Rng, clients: Client[]): Client {
  // 45% of the time draw from the first 16 "regulars", so the clients page
  // has people with real history and multi-salon visits, not 330 strangers.
  return chance(rng, 0.45)
    ? clients[int(rng, 0, 15)]
    : clients[int(rng, 0, clients.length - 1)];
}

// ---------- the appointments themselves ----------

type PlannedBooking = {
  clientName: string;
  clientPhone: string;
  startMin: number;
  durationMin: number;
  service: string;
  notes: string | null;
  status: "confirmed" | "cancelled" | "done";
  channel: "call_center" | "front_desk";
};

const roundUpToGrid = (minutes: number, slot: number) => Math.ceil(minutes / slot) * slot;

function planSalon(
  rng: Rng,
  salon: Salon,
  clients: Client[],
  target: number,
  nowMin: number,
): PlannedBooking[] {
  const { opensAtMin: opens, closesAtMin: close, slotMin: slot } = salon;
  // Distinct services keep same-service overlaps impossible; shuffling gives a
  // varied spread of them rather than the first N in the catalogue.
  const services = shuffle(rng, getServicesForSalon(salon.slug).slice());

  const raw: Array<{ startMin: number; durationMin: number; service: string }> = [];
  // What each service already occupies, so a second run of the same service
  // can never overlap the first — the one thing the database forbids.
  const occupied = new Map<string, Array<[number, number]>>();

  const tryPlace = (service: ServiceCatalogEntry, start: number): boolean => {
    const end = start + service.durationMin;
    if (start < opens || end > close || (start - opens) % slot !== 0) return false;
    const iv = occupied.get(service.name) ?? [];
    for (const [s, e] of iv) if (start < e && s < end) return false;
    iv.push([start, end]);
    occupied.set(service.name, iv);
    raw.push({ startMin: start, durationMin: service.durationMin, service: service.name });
    return true;
  };

  const gridSpan = Math.max(0, Math.floor((close - opens) / slot) - 8);

  // Pass 1 — variety. Each service gets a short run of 5–9 bookings, so ~16
  // different services fill the day instead of a handful. The first four open
  // exactly at opening time, which forces several different services onto the
  // very same minute (the concurrency case); the rest start staggered across
  // the day so the board is busy from open to close.
  for (let idx = 0; idx < services.length && raw.length < target; idx += 1) {
    const svc = services[idx];
    const cap = int(rng, 5, 9);
    let start = idx < 4 ? opens : opens + int(rng, 0, gridSpan) * slot;
    let placed = 0;
    while (placed < cap && raw.length < target && start + svc.durationMin <= close) {
      if (tryPlace(svc, start)) placed += 1;
      let next = start + roundUpToGrid(svc.durationMin, slot);
      if (chance(rng, 0.22)) next += slot * int(rng, 1, 2); // an occasional gap
      start = next;
    }
  }

  // Pass 2 — top up. If variety alone did not reach the target, fill each
  // service's remaining free slots until it does. Guaranteed to get there:
  // one service filling the whole day already exceeds 100.
  for (let idx = 0; idx < services.length && raw.length < target; idx += 1) {
    const svc = services[idx];
    for (let start = opens; raw.length < target && start + svc.durationMin <= close; ) {
      tryPlace(svc, start);
      start += roundUpToGrid(svc.durationMin, slot);
    }
  }

  return raw.map(({ startMin, durationMin, service }) => {
    const client = pickClient(rng, clients);
    const finished = startMin + durationMin <= nowMin;
    const status: PlannedBooking["status"] = finished
      ? (chance(rng, 0.7) ? "done" : chance(rng, 0.6) ? "confirmed" : "cancelled")
      : chance(rng, 0.85) ? "confirmed" : "cancelled";
    return {
      clientName: client.name,
      clientPhone: client.phone,
      startMin,
      durationMin,
      service,
      notes: chance(rng, 0.15) ? pick(rng, NOTES) : null,
      status,
      // Every booking is a call-centre booking — there is no front-desk poste.
      channel: "call_center",
    };
  });
}

// ---------- output: either SQL text, or real inserts ----------

const sqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

function toSql(salonSlug: string, date: string, rows: PlannedBooking[]): string {
  const salonRef = `(SELECT id FROM salons WHERE slug = ${sqlLiteral(salonSlug)})`;
  const values = rows
    .map((r) => {
      const notes = r.notes === null ? "NULL" : sqlLiteral(r.notes);
      return `  (${salonRef}, ${sqlLiteral(r.clientName)}, ${sqlLiteral(r.clientPhone)}, ` +
        `DATE ${sqlLiteral(date)}, ${r.startMin}, ${r.durationMin}, ${sqlLiteral(r.service)}, ` +
        `${notes}, ${sqlLiteral(r.status)}, ${sqlLiteral(r.channel)})`;
    })
    .join(",\n");
  return (
    `INSERT INTO bookings\n` +
    `  (salon_id, client_name, client_phone, booking_date, start_min, duration_min, service, notes, status, channel)\n` +
    `VALUES\n${values}\n` +
    `ON CONFLICT DO NOTHING;`
  );
}

function summarise(slug: string, rows: PlannedBooking[]): void {
  const byStart = new Map<number, Set<string>>();
  for (const r of rows) {
    if (r.status === "cancelled") continue;
    const set = byStart.get(r.startMin) ?? new Set<string>();
    set.add(r.service);
    byStart.set(r.startMin, set);
  }
  const concurrent = [...byStart.values()].filter((s) => s.size >= 2).length;
  const status = { confirmed: 0, done: 0, cancelled: 0 };
  for (const r of rows) status[r.status] += 1;
  const clients = new Set(rows.map((r) => r.clientPhone)).size;
  const services = new Set(rows.map((r) => r.service)).size;
  console.log(
    `  ${slug.padEnd(7)} ${String(rows.length).padStart(3)} bookings · ` +
      `${services} services · ${clients} clients · ` +
      `${concurrent} start-times with concurrent services · ` +
      `confirmed ${status.confirmed}/done ${status.done}/cancelled ${status.cancelled}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const flag = (name: string) => args.includes(`--${name}`);

  const date = arg("date") ?? todayInSalonTz();
  const target = Number(arg("per") ?? 110);
  const seed = Number(arg("seed") ?? 20260916);
  const sqlPath = arg("sql");
  const fresh = flag("fresh");
  const nowMin = nowMinutesInSalonTz();

  const rng = mulberry32(seed);
  const clients = buildClients(rng);

  const salonRows = await db.select().from(salons).orderBy(salons.sortOrder);
  if (salonRows.length === 0) {
    console.error("No salons found. Run `npm run db:seed` (or docs/neon-setup.sql) first.");
    process.exit(1);
  }

  console.log(`Planning ~${target} appointments per salon for ${date} (salon-local time):`);
  const planned = salonRows.map((salon) => ({
    salon,
    rows: planSalon(rng, salon, clients, target, nowMin),
  }));
  for (const { salon, rows } of planned) summarise(salon.slug, rows);
  const total = planned.reduce((n, p) => n + p.rows.length, 0);

  if (sqlPath) {
    const banner =
      `-- Demo appointments for ${date}. Paste into the Neon SQL Editor and Run.\n` +
      `-- Re-runnable: ON CONFLICT DO NOTHING skips rows already present.\n\n`;
    const body = planned.map((p) => toSql(p.salon.slug, date, p.rows)).join("\n\n");
    writeFileSync(sqlPath, banner + body + "\n");
    console.log(`\nWrote ${total} appointments to ${sqlPath} (nothing inserted).`);
    return;
  }

  if (fresh) {
    const ids = salonRows.map((s) => s.id);
    const deleted = await db
      .delete(bookings)
      .where(and(inArray(bookings.salonId, ids), eq(bookings.bookingDate, date)))
      .returning({ id: bookings.id });
    console.log(`\n--fresh: removed ${deleted.length} existing booking(s) for ${date}.`);
  }

  let inserted = 0;
  for (const { salon, rows } of planned) {
    const values = rows.map((r) => ({
      salonId: salon.id,
      clientName: r.clientName,
      clientPhone: r.clientPhone,
      bookingDate: date,
      startMin: r.startMin,
      durationMin: r.durationMin,
      service: r.service,
      notes: r.notes,
      status: r.status,
      channel: r.channel,
    }));
    // Chunked so a single statement never carries an unreasonable parameter count.
    for (let i = 0; i < values.length; i += 100) {
      const done = await db
        .insert(bookings)
        .values(values.slice(i, i + 100))
        .onConflictDoNothing()
        .returning({ id: bookings.id });
      inserted += done.length;
    }
  }
  console.log(`\nInserted ${inserted} of ${total} planned appointments (existing ones skipped).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

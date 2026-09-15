import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, it } from "vitest";

import { bookings as bookingsTable, services, type Salon } from "@/db/schema";
import { cancelBooking, createBooking, updateBooking } from "@/lib/bookings";
import { listAllClients, searchClientSuggestions } from "@/lib/clients";
import { getServicesForSalon } from "@/lib/services-catalog";
import {
  createService,
  deleteService,
  listAllServicesGroupedBySalon,
  listServicesForSalon,
  seedServicesIfEmpty,
  updateService,
} from "@/lib/services";

import { db, describeIfDb } from "../helpers/db";
import { closeDb, futureDate, resetWithRealSalons } from "../helpers/fixtures";

/**
 * The owner's service catalogue and the clients directory, against a real
 * database. The catalogue is edited from /owner/services and seeded on that
 * page's first visit — which Next.js may render twice at once (a link
 * prefetch and the click), so seeding is exercised concurrently too.
 */

let salons: Record<"vip" | "gold" | "barber", Salon>;

beforeEach(async () => {
  salons = await resetWithRealSalons();
});

afterAll(closeDb);

describeIfDb("service catalogue", () => {
  it("seeds a salon's catalogue once, from the static list, in order", async () => {
    await seedServicesIfEmpty(salons.gold.id, "gold");
    const rows = await listServicesForSalon(salons.gold.id);
    const expected = getServicesForSalon("gold");
    expect(rows.map((r) => r.name)).toEqual(expected.map((e) => e.name));
    expect(rows.map((r) => r.price)).toEqual(expected.map((e) => e.price));
    await seedServicesIfEmpty(salons.gold.id, "gold");
    expect(await listServicesForSalon(salons.gold.id)).toHaveLength(expected.length);
  });

  it("never duplicates the catalogue when two renders seed the same salon at once", async () => {
    for (let round = 0; round < 10; round += 1) {
      await db.delete(services).where(eq(services.salonId, salons.vip.id));
      await Promise.all(Array.from({ length: 4 }, () => seedServicesIfEmpty(salons.vip.id, "vip")));
      const rows = await listServicesForSalon(salons.vip.id);
      expect(rows, `round ${round}`).toHaveLength(getServicesForSalon("vip").length);
    }
  });

  it("does not seed a salon the owner has already started editing", async () => {
    await createService({ salonId: salons.barber.id, category: "Coiffure", name: "Coupe Maison", durationMin: 30, price: 80 });
    await seedServicesIfEmpty(salons.barber.id, "barber");
    expect(await listServicesForSalon(salons.barber.id)).toHaveLength(1);
  });

  it("places a new service at the end of the salon's list", async () => {
    await seedServicesIfEmpty(salons.gold.id, "gold");
    const created = await createService({
      salonId: salons.gold.id,
      category: "Onglerie",
      name: "Nouveau Soin Test",
      durationMin: 45,
      price: 120,
    });
    const rows = await listServicesForSalon(salons.gold.id);
    expect(rows.at(-1)?.id).toBe(created.id);
    expect(created.sortOrder).toBeGreaterThan(Math.max(...rows.slice(0, -1).map((r) => r.sortOrder)));
  });

  it("starts a salon's first service at position 0", async () => {
    const created = await createService({ salonId: salons.vip.id, category: "A", name: "Premier", durationMin: 30, price: 0 });
    expect(created.sortOrder).toBe(0);
  });

  it("updates only the fields given and reports a missing service", async () => {
    const created = await createService({ salonId: salons.vip.id, category: "A", name: "Soin", durationMin: 30, price: 100 });
    const updated = await updateService(created.id, { price: 150 });
    expect(updated).toMatchObject({ name: "Soin", durationMin: 30, price: 150 });
    expect(await updateService(created.id, {})).toMatchObject({ price: 150 });
    expect(await updateService("5f1b0c1e-8d2a-4c1b-9e7f-000000000000", { price: 1 })).toBeNull();
  });

  it("deletes a service and reports whether anything was deleted", async () => {
    const created = await createService({ salonId: salons.vip.id, category: "A", name: "Soin", durationMin: 30, price: 100 });
    expect(await deleteService(created.id)).toBe(true);
    expect(await deleteService(created.id)).toBe(false);
  });

  it("groups every salon's services for the owner screen", async () => {
    await seedServicesIfEmpty(salons.gold.id, "gold");
    const grouped = await listAllServicesGroupedBySalon();
    expect(grouped.map((g) => g.salonSlug)).toEqual(["vip", "gold", "barber"]);
    expect(grouped.find((g) => g.salonSlug === "gold")?.items.length).toBe(getServicesForSalon("gold").length);
    expect(grouped.find((g) => g.salonSlug === "vip")?.items).toEqual([]);
  });
});

describeIfDb("clients directory", () => {
  const day = futureDate(6);

  async function book(name: string, phone: string, startMin: number, salonSlug = "vip", service = "Manucure Simple") {
    const { booking } = await createBooking({
      salonSlug,
      clientName: name,
      clientPhone: phone,
      bookingDate: day,
      startMin,
      durationMin: 30,
      service,
      notes: undefined,
      channel: "front_desk",
    });
    return booking;
  }

  it("groups bookings by phone number and counts each status", async () => {
    const a = await book("Sarah Benali", "0612345678", 600);
    const b = await book("Sarah B.", "+212 6 12 34 56 78", 660, "gold");
    await book("Karim Alaoui", "0711223344", 600, "vip", "Pédicure SPA");
    await updateBooking(a.id, { status: "done" });
    await cancelBooking(b.id);

    const clients = await listAllClients();
    expect(clients).toHaveLength(2);
    const sarah = clients.find((c) => c.clientPhone === "+212612345678")!;
    expect(sarah).toMatchObject({ totalBookings: 2, doneBookings: 1, cancelledBookings: 1, confirmedBookings: 0 });
    expect(sarah.salonsVisited.sort()).toEqual(["L'Atelier Gold", "L'Atelier VIP"]);
    expect(sarah.formattedPhone).toBe("06 12 34 56 78");
    expect(clients[0].totalBookings).toBeGreaterThanOrEqual(clients[1].totalBookings);
  });

  it("suggests clients by partial name or phone, most frequent first", async () => {
    await book("Sarah Benali", "0612345678", 600);
    await book("Sarah Benali", "0612345678", 630);
    await book("Samira Tazi", "0699887766", 660);
    const byName = await searchClientSuggestions("sa");
    expect(byName.map((s) => s.name)).toEqual(["Sarah Benali", "Samira Tazi"]);
    expect(byName[0].totalBookings).toBe(2);
    expect((await searchClientSuggestions("99887")).map((s) => s.name)).toEqual(["Samira Tazi"]);
    expect(await searchClientSuggestions("   ")).toEqual([]);
  });

  it("finds a client by the phone number typed the national way", async () => {
    await book("Sarah Benali", "0612345678", 600);
    await book("Samira Tazi", "0699887766", 660);
    expect((await searchClientSuggestions("0612")).map((s) => s.name)).toEqual(["Sarah Benali"]);
    expect((await searchClientSuggestions("06 99 88")).map((s) => s.name)).toEqual(["Samira Tazi"]);
  });

  it("never reports a future booking as the last visit", async () => {
    const upcoming = await book("Sarah Benali", "0612345678", 600);
    // A past visit cannot be booked through the API any more; it is history.
    await db.insert(bookingsTable).values({
      salonId: salons.vip.id,
      clientName: "Sarah Benali",
      clientPhone: "+212612345678",
      bookingDate: "2024-03-02",
      startMin: 600,
      durationMin: 30,
      service: "Coupe",
      channel: "front_desk",
      status: "done",
    });

    const [sarah] = await listAllClients();
    expect(sarah.lastBookingDate).toBe(day);
    expect(sarah.lastVisitDate).toBe("2024-03-02");
    expect(sarah.nextBooking).toEqual({ bookingDate: day, startMin: 600, service: upcoming.service });

    await cancelBooking(upcoming.id);
    const [afterCancel] = await listAllClients();
    expect(afterCancel.nextBooking).toBeNull();
  });

  it("treats LIKE wildcards in the search box as the characters themselves", async () => {
    await book("Sarah Benali", "0612345678", 600);
    await book("Nadia 100% Fidèle", "0611111111", 630);
    expect((await searchClientSuggestions("%")).map((s) => s.name)).toEqual(["Nadia 100% Fidèle"]);
    expect(await searchClientSuggestions("_")).toEqual([]);
    expect(await searchClientSuggestions("\\")).toEqual([]);
  });
});

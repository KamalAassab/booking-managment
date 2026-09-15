import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

import { addDays, nowMinutesInSalonTz, todayInSalonTz } from "@/lib/time";

import { SESSION_COOKIE } from "@/lib/session";
import { UserClient, sessionCookie } from "../helpers/api-client";
import { describeIfDb } from "../helpers/db";
import {
  bookingInput,
  closeDb,
  countBookings,
  futureDate,
  nextPhone,
  prng,
  resetWithRealSalons,
} from "../helpers/fixtures";
import { inProcessTransport } from "../helpers/transport-inprocess";

vi.mock("next/headers", () => import("../helpers/next-headers"));

/**
 * The HTTP contract of every booking endpoint, through the real route
 * handlers: who may call it, what each malformed request becomes, and the
 * exact status code for each business outcome. The booking sheet branches on
 * these codes — a 409 refreshes the grid, a 400 shows the sentence — so a
 * wrong code is a wrong screen for the agent.
 */

const staff = () => new UserClient("staff", inProcessTransport, sessionCookie("staff"));
const owner = () => new UserClient("owner", inProcessTransport, sessionCookie("owner"));
const anonymous = () => new UserClient("anonymous", inProcessTransport, null);

const DAY = futureDate(9);

const input = (overrides: Record<string, unknown> = {}) =>
  bookingInput({ bookingDate: DAY, ...overrides });

beforeEach(async () => {
  await resetWithRealSalons();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(closeDb);

describeIfDb("authentication on every booking endpoint", () => {
  const id = "5f1b0c1e-8d2a-4c1b-9e7f-000000000000";
  const calls: Array<[string, (u: UserClient) => Promise<{ status: number }>]> = [
    ["GET /api/bookings", (u) => u.list("vip", DAY)],
    ["POST /api/bookings", (u) => u.create(input())],
    ["PATCH /api/bookings/[id]", (u) => u.update(id, { clientName: "Nom Nom" })],
    ["DELETE /api/bookings/[id]", (u) => u.cancel(id)],
    ["GET /api/bookings/range", (u) => u.range("vip", DAY, DAY)],
    ["GET /api/bookings/watermark", (u) => u.watermark("vip", DAY)],
  ];

  it.each(calls)("%s answers 401 without a session", async (_name, call) => {
    expect((await call(anonymous())).status).toBe(401);
  });

  it.each(calls)("%s answers 401 for a forged or tampered cookie", async (_name, call) => {
    const good = sessionCookie("staff");
    const forged = [
      `${SESSION_COOKIE}=${good.split("=")[1].slice(0, -2)}xx`,
      `${SESSION_COOKIE}=eyJzdWIiOiJ4Iiwicm9sZSI6Im93bmVyIiwiaWF0IjoxLCJleHAiOjk5OTk5OTk5OTl9.c2ln`,
      `${SESSION_COOKIE}=`,
      `${SESSION_COOKIE}=not-a-token`,
    ];
    for (const cookie of forged) {
      const user = new UserClient("forger", inProcessTransport, cookie);
      expect((await call(user)).status, cookie).toBe(401);
    }
  });

  it("answers 401 for a session signed with another secret", async () => {
    const original = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "some-other-deployment-secret-value";
    const foreign = sessionCookie("staff");
    process.env.SESSION_SECRET = original;
    const user = new UserClient("foreign", inProcessTransport, foreign);
    expect((await user.list("vip", DAY)).status).toBe(401);
  });

  it("answers 401 for an expired session", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() - 31 * 24 * 3600 * 1000));
    const expired = sessionCookie("staff");
    vi.useRealTimers();
    const user = new UserClient("expired", inProcessTransport, expired);
    expect((await user.list("vip", DAY)).status).toBe(401);
  });

  it("lets both the staff and the owner account book", async () => {
    expect((await staff().create(input())).status).toBe(201);
    expect((await owner().create(input({ startMin: 660 }))).status).toBe(201);
  });

  it("never marks a 401 as cacheable", async () => {
    const res = await fetchRaw("GET", `/api/bookings?salon=vip&date=${DAY}`, null);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });
});

async function fetchRaw(method: string, path: string, cookie: string | null) {
  const route = await import("@/app/api/bookings/route");
  const { requestContext } = await import("../helpers/request-context");
  const cookies = new Map<string, string>();
  if (cookie) cookies.set(SESSION_COOKIE, cookie.split("=")[1]);
  const request = new Request(new URL(path, "http://atelier.test"), { method });
  return requestContext.run({ cookies, headers: request.headers }, () =>
    (route as unknown as Record<string, (r: Request) => Promise<Response>>)[method](request),
  );
}

describeIfDb("POST /api/bookings", () => {
  it("creates a booking and returns it with a WhatsApp link", async () => {
    const res = await staff().create(
      input({ clientName: "Sarah Benali", clientPhone: "06 12 34 56 78", channel: "call_center" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({
      clientName: "Sarah Benali",
      clientPhone: "+212612345678",
      bookingDate: DAY,
      status: "confirmed",
      channel: "call_center",
    });
    expect(res.body.whatsappUrl).toMatch(/^https:\/\/api\.whatsapp\.com\/send\?phone=212612345678&text=/);
    // The DTO must not leak audit columns.
    expect(Object.keys(res.body.booking ?? {}).sort()).toEqual(
      ["bookingDate", "channel", "clientName", "clientPhone", "durationMin", "id", "notes", "salonId", "service", "startMin", "status"].sort(),
    );
  });

  it("answers 409 with the agent-facing sentence when the slot is taken", async () => {
    await staff().create(input());
    const res = await staff().create(input());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Ce créneau vient d'être réservé sur un autre poste.");
  });

  it("answers 201 for a different service at the same time", async () => {
    await staff().create(input({ service: "Manucure Simple" }));
    expect((await staff().create(input({ service: "Pédicure SPA" }))).status).toBe(201);
  });

  it("answers 400 for an unparseable body", async () => {
    const user = staff();
    for (const raw of ["", "{", "not json", "null", "[]", "42", '"text"']) {
      const res = await user.raw("POST", "/api/bookings", raw);
      expect(res.status, JSON.stringify(raw)).toBe(400);
      expect(typeof res.body.error).toBe("string");
    }
  });

  const invalid: Array<[string, Record<string, unknown>]> = [
    ["missing salon", { salonSlug: undefined }],
    ["unknown salon", { salonSlug: "platinum" }],
    ["salon slug too long", { salonSlug: "x".repeat(25) }],
    ["one-letter name", { clientName: "A" }],
    ["whitespace name", { clientName: "     " }],
    ["name too long", { clientName: "N".repeat(121) }],
    ["missing phone", { clientPhone: "" }],
    ["invalid phone", { clientPhone: "12345" }],
    ["phone with letters", { clientPhone: "06 12 AB 56 78" }],
    ["phone too long", { clientPhone: "0".repeat(33) }],
    ["impossible date", { bookingDate: "2030-02-30" }],
    ["wrong date shape", { bookingDate: "12/03/2030" }],
    ["past date", { bookingDate: addDays(todayInSalonTz(), -1) }],
    ["year out of range", { bookingDate: "2101-01-01" }],
    ["start before opening", { startMin: 570 }],
    ["start off grid", { startMin: 615 }],
    ["start negative", { startMin: -30 }],
    ["start past midnight", { startMin: 1440 }],
    ["start not integer", { startMin: 600.5 }],
    ["start as string", { startMin: "600" }],
    ["duration too short", { durationMin: 4 }],
    ["duration zero", { durationMin: 0 }],
    ["duration too long", { durationMin: 481 }],
    ["duration not integer", { durationMin: 30.5 }],
    ["runs past closing", { startMin: 1290, durationMin: 60 }],
    ["runs past midnight", { salonSlug: "gold", startMin: 1350, durationMin: 120 }],
    ["blank service", { service: "   " }],
    ["service too long", { service: "S".repeat(121) }],
    ["notes too long", { notes: "n".repeat(1001) }],
    ["unknown channel", { channel: "instagram" }],
    ["missing channel", { channel: undefined }],
    ["null name", { clientName: null }],
  ];

  it.each(invalid)("answers 400 for %s", async (_name, overrides) => {
    const res = await staff().create(input(overrides));
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error?.length).toBeGreaterThan(3);
    expect(await countBookings()).toBe(0);
  });

  it("answers 400 for a start time earlier today", async () => {
    // A 24-hour salon so there is always a past slot and a future slot today,
    // whatever time the suite runs at.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-06-10T13:10:00Z")); // 14:10 in Casablanca
    try {
      const today = todayInSalonTz();
      expect(nowMinutesInSalonTz()).toBe(14 * 60 + 10);
      const user = staff();
      const past = await user.create(input({ salonSlug: "gold", bookingDate: today, startMin: 13 * 60 }));
      expect(past.status).toBe(400);
      const future = await user.create(input({ salonSlug: "gold", bookingDate: today, startMin: 15 * 60 }));
      expect(future.status).toBe(201);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts the slot under way, which the grid still offers, and refuses one that has ended", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-06-10T13:10:00Z")); // 14:10 in Casablanca
    try {
      const today = todayInSalonTz();
      const user = staff();
      // 14:00–14:30 is still running. The day grid, week grid and booking
      // sheet all offer it — a slot is past only once it has ended — so a
      // walk-in booked into it at 14:10 must not bounce off the server.
      const current = await user.create(input({ salonSlug: "gold", bookingDate: today, startMin: 840 }));
      expect(current.status, JSON.stringify(current.body)).toBe(201);
      // 13:30–14:00 is over.
      const ended = await user.create(input({ salonSlug: "gold", bookingDate: today, startMin: 810 }));
      expect(ended.status).toBe(400);
      expect(ended.body.error).toBe("Ce créneau est déjà passé.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts every realistic way of dictating a Moroccan number and stores the same E.164", async () => {
    const user = staff();
    const shapes = ["0612345678", "06 12 34 56 78", "06-12-34-56-78", "+212612345678", "+212 6 12 34 56 78", "00212612345678", "212612345678", "612345678", "+212 0612345678"];
    let start = 600;
    for (const clientPhone of shapes) {
      const res = await user.create(input({ clientPhone, startMin: start }));
      expect(res.status, clientPhone).toBe(201);
      expect(res.body.booking?.clientPhone, clientPhone).toBe("+212612345678");
      start += 30;
    }
  });

  it("ignores fields the client has no business setting", async () => {
    const res = await staff().create(
      input({ status: "done", id: "5f1b0c1e-8d2a-4c1b-9e7f-000000000000", salonId: "x", createdAt: "1999-01-01" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.booking?.status).toBe("confirmed");
    expect(res.body.booking?.id).not.toBe("5f1b0c1e-8d2a-4c1b-9e7f-000000000000");
  });

  it("stores names and notes with quotes, accents, emoji and SQL-looking text verbatim", async () => {
    const clientName = `Zoé O'Brien-El Fassi 💅 "; drop table bookings; --`;
    const notes = `Allergie: <script>alert(1)</script> & 'latex' — 100%`;
    const res = await staff().create(input({ clientName, notes }));
    expect(res.status).toBe(201);
    const list = await staff().list("vip", DAY);
    expect(list.body.bookings?.[0]).toMatchObject({ clientName, notes });
  });
});

describeIfDb("PATCH /api/bookings/[id]", () => {
  async function seeded(overrides: Record<string, unknown> = {}) {
    const res = await staff().create(input(overrides));
    expect(res.status).toBe(201);
    return res.body.booking!;
  }

  it("answers 400 for an id that is not a UUID", async () => {
    for (const id of ["1", "abc", "5f1b0c1e-8d2a-4c1b-9e7f", "' or 1=1 --"]) {
      const res = await staff().update(encodeURIComponent(id), { clientName: "Nom Nom" });
      expect(res.status, id).toBe(400);
    }
  });

  it("answers 404 for a well-formed id that does not exist", async () => {
    const res = await staff().update("5f1b0c1e-8d2a-4c1b-9e7f-000000000000", { clientName: "Nom Nom" });
    expect(res.status).toBe(404);
  });

  it("answers 400 for an unparseable body", async () => {
    const booking = await seeded();
    for (const raw of ["", "{", "nope"]) {
      expect((await staff().raw("PATCH", `/api/bookings/${booking.id}`, raw)).status).toBe(400);
    }
  });

  it("applies exactly what the booking sheet sends on save", async () => {
    const booking = await seeded({ notes: "avant" });
    const res = await staff().update(booking.id, {
      clientName: "  Nadia Alaoui ",
      clientPhone: "07 12 34 56 78",
      startMin: 720,
      durationMin: 60,
      service: "Pédicure SPA",
      notes: "après",
    });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({
      clientName: "Nadia Alaoui",
      clientPhone: "+212712345678",
      startMin: 720,
      durationMin: 60,
      service: "Pédicure SPA",
      notes: "après",
    });
  });

  it("clears the note when the sheet sends an emptied note field", async () => {
    const booking = await seeded({ notes: "à supprimer" });
    const res = await staff().update(booking.id, {
      clientName: booking.clientName,
      clientPhone: booking.clientPhone,
      startMin: booking.startMin,
      durationMin: booking.durationMin,
      service: booking.service,
      notes: "",
    });
    expect(res.status).toBe(200);
    expect(res.body.booking?.notes).toBeNull();
    expect((await staff().list("vip", DAY)).body.bookings?.[0].notes).toBeNull();
  });

  it("answers 409 when moved onto the same service and leaves the booking where it was", async () => {
    await seeded({ startMin: 600 });
    const moving = await seeded({ startMin: 720 });
    const res = await staff().update(moving.id, { startMin: 600 });
    expect(res.status).toBe(409);
    const list = await staff().list("vip", DAY);
    expect(list.body.bookings?.find((b) => b.id === moving.id)?.startMin).toBe(720);
  });

  const invalidPatch: Array<[string, Record<string, unknown>]> = [
    ["a past date", { bookingDate: addDays(todayInSalonTz(), -1) }],
    ["an impossible date", { bookingDate: "2030-02-31" }],
    ["a one-letter name", { clientName: "B" }],
    ["an invalid phone", { clientPhone: "0000" }],
    ["a blank service", { service: "  " }],
    ["an unknown status", { status: "archived" }],
    ["a start before opening", { startMin: 540 }],
    ["a start off the grid", { startMin: 645 }],
    ["a duration past closing", { durationMin: 480 }],
    ["start and duration past midnight", { startMin: 1430, durationMin: 60 }],
    ["a duration below the minimum", { durationMin: 4 }],
  ];

  it.each(invalidPatch)("answers 400 for %s", async (_name, patch) => {
    const booking = await seeded({ startMin: 900 });
    const res = await staff().update(booking.id, patch);
    expect(res.status).toBe(400);
    const after = (await staff().list("vip", DAY)).body.bookings?.[0];
    expect(after).toMatchObject({ startMin: 900, status: "confirmed", clientName: booking.clientName });
  });

  it("answers 200 and changes nothing for an empty patch", async () => {
    const booking = await seeded();
    const res = await staff().update(booking.id, {});
    expect(res.status).toBe(200);
    expect(res.body.booking).toEqual(booking);
  });

  it("marks done, then confirmed again", async () => {
    const booking = await seeded();
    expect((await staff().update(booking.id, { status: "done" })).body.booking?.status).toBe("done");
    expect((await staff().update(booking.id, { status: "confirmed" })).body.booking?.status).toBe("confirmed");
  });

  it("answers 409 when reviving a cancelled booking whose slot was re-sold", async () => {
    const booking = await seeded();
    expect((await staff().cancel(booking.id)).status).toBe(200);
    expect((await staff().create(input())).status).toBe(201);
    expect((await staff().update(booking.id, { status: "confirmed" })).status).toBe(409);
  });
});

describeIfDb("DELETE /api/bookings/[id]", () => {
  it("cancels, frees the slot, and is idempotent", async () => {
    const created = await staff().create(input());
    const id = created.body.booking!.id;
    const first = await staff().cancel(id);
    expect(first.status).toBe(200);
    expect(first.body.booking?.status).toBe("cancelled");
    expect((await staff().cancel(id)).status).toBe(200);
    expect((await staff().create(input())).status).toBe(201);
  });

  it("answers 404 for an unknown id and 400 for a malformed one", async () => {
    expect((await staff().cancel("5f1b0c1e-8d2a-4c1b-9e7f-000000000000")).status).toBe(404);
    expect((await staff().cancel("nope")).status).toBe(400);
  });

  it("answers 405 for methods the route does not implement", async () => {
    const user = staff();
    expect((await user.request("PUT", "/api/bookings/5f1b0c1e-8d2a-4c1b-9e7f-000000000000", {})).status).toBe(405);
    expect((await user.request("DELETE", "/api/bookings")).status).toBe(405);
  });
});

describeIfDb("GET endpoints", () => {
  it("lists a day, 400s a bad query and 404s an unknown salon", async () => {
    await staff().create(input());
    const user = staff();
    expect((await user.list("vip", DAY)).body.bookings).toHaveLength(1);
    expect((await user.list("vip", "2030-02-30")).status).toBe(400);
    expect((await user.list("", DAY)).status).toBe(400);
    expect((await user.request("GET", "/api/bookings")).status).toBe(400);
    expect((await user.list("platinum", DAY)).status).toBe(404);
  });

  it("serves a range without cancelled bookings, and validates it", async () => {
    const a = await staff().create(input({ bookingDate: futureDate(9) }));
    await staff().create(input({ bookingDate: futureDate(10) }));
    await staff().cancel(a.body.booking!.id);
    const res = await staff().range("vip", futureDate(8), futureDate(11));
    expect(res.status).toBe(200);
    expect(res.body.bookings).toHaveLength(1);
    expect((await staff().range("vip", "x", futureDate(11))).status).toBe(400);
    expect((await staff().range("platinum", futureDate(8), futureDate(11))).status).toBe(404);
  });

  it("answers the watermark protocol: changed:true with rows only when `since` differs", async () => {
    const user = staff();
    const first = await user.watermark("vip", DAY);
    expect(first.status).toBe(200);
    expect(first.body.changed).toBe(true);
    expect(first.body.bookings).toBeUndefined();

    const unchanged = await user.watermark("vip", DAY, first.body.watermark);
    expect(unchanged.body).toEqual({ watermark: first.body.watermark, changed: false });

    await user.create(input({ bookingDate: DAY }));
    const changed = await user.watermark("vip", DAY, first.body.watermark);
    expect(changed.body.changed).toBe(true);
    expect(changed.body.bookings).toHaveLength(1);
    expect(changed.body.watermark).not.toBe(first.body.watermark);

    expect((await user.watermark("vip", "bad")).status).toBe(400);
    expect((await user.watermark("platinum", DAY)).status).toBe(404);
  });
});

describeIfDb("watermark over a visible range (week and month views)", () => {
  const from = futureDate(8);
  const to = futureDate(20);

  it("reports a range watermark that moves for a booking on any visible day, not only the selected one", async () => {
    const user = staff();
    const first = await user.request("GET", `/api/bookings/watermark?salon=vip&date=${DAY}&from=${from}&to=${to}`);
    expect(first.status).toBe(200);
    expect(typeof first.body.rangeWatermark).toBe("string");
    expect(first.body.rangeChanged).toBe(true);

    const same = await user.request(
      "GET",
      `/api/bookings/watermark?salon=vip&date=${DAY}&since=${encodeURIComponent(first.body.watermark)}&from=${from}&to=${to}&sinceRange=${encodeURIComponent(first.body.rangeWatermark)}`,
    );
    expect(same.body).toMatchObject({ changed: false, rangeChanged: false });

    // Another agent books a different day inside the visible month.
    expect((await user.create(input({ bookingDate: futureDate(15) }))).status).toBe(201);
    const after = await user.request(
      "GET",
      `/api/bookings/watermark?salon=vip&date=${DAY}&since=${encodeURIComponent(first.body.watermark)}&from=${from}&to=${to}&sinceRange=${encodeURIComponent(first.body.rangeWatermark)}`,
    );
    expect(after.body.changed).toBe(false);
    expect(after.body.rangeChanged).toBe(true);
    expect(after.body.rangeWatermark).not.toBe(first.body.rangeWatermark);
  });

  it("ignores bookings outside the range and in other salons", async () => {
    const user = staff();
    const first = await user.request("GET", `/api/bookings/watermark?salon=vip&date=${DAY}&from=${from}&to=${to}`);
    await user.create(input({ bookingDate: futureDate(25) }));
    await user.create(input({ salonSlug: "gold", bookingDate: futureDate(12) }));
    const after = await user.request("GET", `/api/bookings/watermark?salon=vip&date=${DAY}&from=${from}&to=${to}`);
    expect(after.body.rangeWatermark).toBe(first.body.rangeWatermark);
  });

  it("answers 400 for a malformed, reversed or oversized range, and omits range fields when none is asked", async () => {
    const user = staff();
    for (const q of [
      `from=${from}`,
      `from=nope&to=${to}`,
      `from=${to}&to=${from}`,
      `from=${futureDate(1)}&to=${futureDate(100)}`,
    ]) {
      expect((await user.request("GET", `/api/bookings/watermark?salon=vip&date=${DAY}&${q}`)).status, q).toBe(400);
    }
    const plain = await user.watermark("vip", DAY);
    expect(plain.body).not.toHaveProperty("rangeWatermark");
  });
});

describeIfDb("live service catalogue in API responses", () => {
  it("quotes the owner's current price in the WhatsApp link, not the static one", async () => {
    const { db } = await import("../helpers/db");
    const { services } = await import("@/db/schema");
    const { seedServicesIfEmpty } = await import("@/lib/services");
    const { eq } = await import("drizzle-orm");
    const salonsRows = await db.query.salons.findMany();
    const vip = salonsRows.find((s) => s.slug === "vip")!;
    await seedServicesIfEmpty(vip.id, "vip");
    await db.update(services).set({ price: 777 }).where(eq(services.name, "Manucure Simple"));

    const res = await staff().create(input({ service: "Manucure Simple" }));
    expect(res.status).toBe(201);
    const text = new URL(res.body.whatsappUrl!).searchParams.get("text")!;
    expect(text).toContain("777 MAD");
    expect(text).not.toContain("50 MAD");
  });

  it("still books, with the static price, when the salon has no catalogue rows yet", async () => {
    const res = await staff().create(input({ service: "Manucure Simple" }));
    expect(res.status).toBe(201);
    expect(new URL(res.body.whatsappUrl!).searchParams.get("text")).toContain("50 MAD");
  });
});

describeIfDb("no request shape produces a 500", () => {
  it("survives 400 random malformed booking payloads", async () => {
    const random = prng(20260914);
    const user = staff();
    const values: unknown[] = [
      null, true, false, 0, -1, 1e308, Number.NaN, "", " ", "a", "vip", "0612345678", "2030-01-01",
      "9999-99-99", [], {}, [1, 2], { $gt: "" }, "x".repeat(5000), "🙂", " ", "' OR 1=1 --",
      600, 30, 1439, 1440, 480, 481, 4, "call_center", "front_desk",
    ];
    const keys = ["salonSlug", "clientName", "clientPhone", "bookingDate", "startMin", "durationMin", "service", "notes", "channel", "status"];
    for (let i = 0; i < 400; i += 1) {
      const body: Record<string, unknown> = input({ bookingDate: futureDate(random.int(2, 30)) });
      for (const key of keys) {
        if (random.chance(0.3)) body[key] = random.pick(values);
        if (random.chance(0.05)) delete body[key];
      }
      const res = await user.create(body);
      expect([201, 400, 409], JSON.stringify(body).slice(0, 300)).toContain(res.status);
    }
  });

  it("survives random malformed patches against real and fake ids", async () => {
    const random = prng(7);
    const user = staff();
    const created = await user.create(input());
    const realId = created.body.booking!.id;
    const values: unknown[] = [null, "", "done", "cancelled", "confirmed", 0, 600, 1440, -5, 4, 481, "2030-01-01", "x", [], {}, "0612345678", "Nom Valide"];
    const keys = ["clientName", "clientPhone", "bookingDate", "startMin", "durationMin", "service", "notes", "status"];
    for (let i = 0; i < 200; i += 1) {
      const patch: Record<string, unknown> = {};
      for (const key of keys) if (random.chance(0.35)) patch[key] = random.pick(values);
      const id = random.chance(0.8) ? realId : random.pick(["5f1b0c1e-8d2a-4c1b-9e7f-000000000000", "zzz", "%00"]);
      const res = await user.update(encodeURIComponent(id), patch);
      expect([200, 400, 404, 409], JSON.stringify({ id, patch })).toContain(res.status);
    }
  });

  it("keeps a distinct phone per client across the fuzzing helpers", () => {
    expect(nextPhone()).not.toBe(nextPhone());
  });
});

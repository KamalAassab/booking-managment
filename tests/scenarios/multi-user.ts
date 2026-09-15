import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Salon } from "@/db/schema";
import { conflictsWithExisting, rangesOverlap, slotsForSalon } from "@/lib/time";
import type { BookingDTO } from "@/lib/types";

import {
  UserClient,
  makeUsers,
  sessionCookie,
  type Transport,
  type TransportRequest,
} from "../helpers/api-client";
import { BookingModel, canonical } from "../helpers/booking-model";
import {
  REAL_SALONS,
  bookingInput,
  findDoubleBookings,
  futureDate,
  nextPhone,
  prng,
  resetWithRealSalons,
  type SalonSlug,
} from "../helpers/fixtures";

/**
 * Five people, one shared account, the same calendar, at the same instant.
 *
 * This is the situation the whole system was specified around (brief §2–§3):
 * four call-centre agents and the front desks all booking into the same
 * salons while clients wait. Every scenario fires its requests together, and
 * every scenario ends with the same two checks, run against the database
 * rather than against what the API claimed:
 *
 *   - nobody ever received a 5xx, whatever the interleaving;
 *   - no two live bookings of the same service overlap in a salon's day.
 *
 * Written once and run over two transports — in-process route handlers and
 * real HTTP against a production build — see tests/integration and tests/e2e.
 */

const TAKEN = "Ce créneau vient d'être réservé sur un autre poste.";

type Recorded = { method: string; path: string; status: number; body: unknown };

function codes(results: { status: number }[]): number[] {
  return results.map((r) => r.status).sort((a, b) => a - b);
}

function count(results: { status: number }[], status: number): number {
  return results.filter((r) => r.status === status).length;
}

export function defineMultiUserScenarios(label: string, baseTransport: Transport) {
  let salons: Record<SalonSlug, Salon>;
  let users: UserClient[];
  let log: Recorded[];

  const transport: Transport = async (req: TransportRequest) => {
    const res = await baseTransport(req);
    log.push({ method: req.method, path: req.path, status: res.status, body: res.body });
    return res;
  };

  const DAY = futureDate(5);
  const input = (overrides: Record<string, unknown> = {}) =>
    bookingInput({ salonSlug: "gold", bookingDate: DAY, ...overrides });

  async function create(user: UserClient, overrides: Record<string, unknown>) {
    const res = await user.create(input(overrides));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.booking!;
  }

  beforeEach(async () => {
    salons = await resetWithRealSalons();
    log = [];
    users = makeUsers(transport, 5);
  });

  afterEach(async () => {
    const serverErrors = log.filter((r) => r.status >= 500);
    expect(serverErrors, "a user was shown a server error").toEqual([]);
    expect(await findDoubleBookings(), "double booking in the database").toEqual([]);
  });

  describe(`${label}: five users racing for the same minutes`, () => {
    it("same salon, day, time and service at once: exactly one wins, four are told it is taken", async () => {
      const results = await Promise.all(
        users.map((u) => u.create(input({ clientName: `Client de ${u.name}`, startMin: 660 }))),
      );
      expect(codes(results)).toEqual([201, 409, 409, 409, 409]);
      for (const loser of results.filter((r) => r.status === 409)) {
        expect(loser.body.error).toBe(TAKEN);
      }
      const winner = results.find((r) => r.status === 201)!.body.booking!;
      const day = await users[0].list("gold", DAY);
      expect(day.body.bookings).toEqual([winner]);
    });

    it("repeats the identical-slot race 40 times without a single double win", async () => {
      const slots = slotsForSalon(salons.gold);
      for (let round = 0; round < 40; round += 1) {
        const startMin = slots[round % slots.length];
        const bookingDate = futureDate(5 + Math.floor(round / slots.length));
        const results = await Promise.all(
          users.map((u) => u.create(input({ bookingDate, startMin }))),
        );
        expect(codes(results), `round ${round}`).toEqual([201, 409, 409, 409, 409]);
      }
    });

    it("the same service typed with different capitalisation is still one chair", async () => {
      const spellings = ["Coupe Enfant", "coupe enfant", "COUPE ENFANT", " Coupe enfant ", "Coupe enfant"];
      const results = await Promise.all(
        users.map((u, i) => u.create(input({ startMin: 720, service: spellings[i] }))),
      );
      expect(count(results, 201)).toBe(1);
      expect(count(results, 409)).toBe(4);
    });

    it("the same slot with five different services: all five are booked", async () => {
      const services = ["Manucure Simple", "Pédicure SPA", "Coloration Basic", "Brushing Signature", "Lissage Kératine"];
      const results = await Promise.all(
        users.map((u, i) => u.create(input({ startMin: 600, service: services[i], durationMin: 60 }))),
      );
      expect(codes(results)).toEqual([201, 201, 201, 201, 201]);
      expect((await users[0].list("gold", DAY)).body.bookings).toHaveLength(5);
    });

    it("three want one service and two want another at the same slot: one of each wins", async () => {
      const services = ["Manucure Simple", "Manucure Simple", "Manucure Simple", "Pédicure SPA", "Pédicure SPA"];
      const results = await Promise.all(
        users.map((u, i) => u.create(input({ startMin: 630, service: services[i] }))),
      );
      const won = results.filter((r) => r.status === 201).map((r) => r.body.booking!.service).sort();
      expect(won).toEqual(["Manucure Simple", "Pédicure SPA"]);
      expect(count(results, 409)).toBe(3);
    });

    it("all five hit the same time in all three salons: one winner per salon", async () => {
      const results = await Promise.all(
        users.flatMap((u) =>
          (["vip", "gold", "barber"] as const).map((salonSlug) =>
            u.create(input({ salonSlug, startMin: 780, service: "Coupe" })).then((r) => ({ ...r, salonSlug })),
          ),
        ),
      );
      for (const slug of ["vip", "gold", "barber"] as const) {
        const forSalon = results.filter((r) => r.salonSlug === slug);
        expect(count(forSalon, 201), slug).toBe(1);
        expect(count(forSalon, 409), slug).toBe(4);
      }
    });

    it("the same slot and service on five different days: all five are booked", async () => {
      const results = await Promise.all(
        users.map((u, i) => u.create(input({ bookingDate: futureDate(5 + i), startMin: 600 }))),
      );
      expect(codes(results)).toEqual([201, 201, 201, 201, 201]);
    });

    it("one user double-submits the same booking five times (retries): one row, four refusals", async () => {
      const payload = input({ startMin: 900 });
      const results = await Promise.all(users.map(() => users[0].create(payload)));
      expect(codes(results)).toEqual([201, 409, 409, 409, 409]);
    });

    it("the owner and four staff race: the role changes nothing", async () => {
      const racers = [new UserClient("owner", transport, sessionCookie("owner")), ...users.slice(0, 4)];
      const results = await Promise.all(racers.map((u) => u.create(input({ startMin: 960 }))));
      expect(codes(results)).toEqual([201, 409, 409, 409, 409]);
    });
  });

  describe(`${label}: five users with overlapping durations`, () => {
    it("overlapping ranges of one service: survivors never overlap and every refusal overlaps a survivor", async () => {
      for (let round = 0; round < 15; round += 1) {
        const bookingDate = futureDate(5 + round);
        const ranges = [
          [600, 90],
          [630, 60],
          [660, 30],
          [570, 60],
          [600, 30],
        ] as const;
        const results = await Promise.all(
          users.map((u, i) =>
            u.create(input({ bookingDate, startMin: ranges[i][0], durationMin: ranges[i][1] })),
          ),
        );
        const winners = results.filter((r) => r.status === 201).map((r) => r.body.booking!);
        expect(winners.length, `round ${round}`).toBeGreaterThan(0);
        results.forEach((r, i) => {
          expect([201, 409], `round ${round} user ${i}`).toContain(r.status);
          if (r.status === 409) {
            const [s, d] = ranges[i];
            expect(
              winners.some((w) => rangesOverlap(s, d, w.startMin, w.durationMin)),
              `round ${round}: user ${i} was refused a slot nobody holds`,
            ).toBe(true);
          }
        });
      }
    });

    it("a back-to-back chain booked by five users at once: all five fit", async () => {
      const results = await Promise.all(
        users.map((u, i) => u.create(input({ startMin: 600 + i * 30, durationMin: 30 }))),
      );
      expect(codes(results)).toEqual([201, 201, 201, 201, 201]);
    });

    it("a three-hour booking against four short ones inside it: all-or-nothing, never both", async () => {
      for (let round = 0; round < 15; round += 1) {
        const bookingDate = futureDate(5 + round);
        const [long, ...shorts] = await Promise.all([
          users[0].create(input({ bookingDate, startMin: 600, durationMin: 180, service: "Protéine Multivitamine Luxe" })),
          users[1].create(input({ bookingDate, startMin: 600, service: "Protéine Multivitamine Luxe" })),
          users[2].create(input({ bookingDate, startMin: 660, service: "Protéine Multivitamine Luxe" })),
          users[3].create(input({ bookingDate, startMin: 720, service: "Protéine Multivitamine Luxe" })),
          users[4].create(input({ bookingDate, startMin: 750, service: "Protéine Multivitamine Luxe" })),
        ]);
        if (long.status === 201) {
          expect(codes(shorts), `round ${round}`).toEqual([409, 409, 409, 409]);
        } else {
          expect(long.status, `round ${round}`).toBe(409);
          expect(codes(shorts), `round ${round}`).toEqual([201, 201, 201, 201]);
        }
      }
    });
  });

  describe(`${label}: five users editing, cancelling and reviving at once`, () => {
    it("five users move five different bookings into the same free slot: one moves, four stay put", async () => {
      const originals = await Promise.all(
        users.map((u, i) => create(u, { startMin: 600 + i * 30 })),
      );
      const results = await Promise.all(
        users.map((u, i) => u.update(originals[i].id, { startMin: 840 })),
      );
      expect(codes(results)).toEqual([200, 409, 409, 409, 409]);
      const day = (await users[0].list("gold", DAY)).body.bookings!;
      results.forEach((r, i) => {
        const row = day.find((b) => b.id === originals[i].id)!;
        expect(row.startMin).toBe(r.status === 200 ? 840 : originals[i].startMin);
      });
    });

    it("one user moves a booking into a slot while four others create there: exactly one gets it", async () => {
      const moving = await create(users[0], { startMin: 600 });
      const [move, ...creates] = await Promise.all([
        users[0].update(moving.id, { startMin: 900 }),
        ...users.slice(1).map((u) => u.create(input({ startMin: 900 }))),
      ]);
      expect([200, 409]).toContain(move.status);
      expect((move.status === 200 ? 1 : 0) + count(creates, 201)).toBe(1);
      const day = (await users[0].list("gold", DAY)).body.bookings!;
      expect(day.find((b) => b.id === moving.id)!.startMin).toBe(move.status === 200 ? 900 : 600);
    });

    it("a cancellation racing four re-bookings of its slot never leaves two live bookings", async () => {
      for (let round = 0; round < 10; round += 1) {
        const bookingDate = futureDate(5 + round);
        const held = await create(users[0], { bookingDate, startMin: 660 });
        const [cancel, ...rebooks] = await Promise.all([
          users[0].cancel(held.id),
          ...users.slice(1).map((u) => u.create(input({ bookingDate, startMin: 660 }))),
        ]);
        expect(cancel.status).toBe(200);
        expect(count(rebooks, 201), `round ${round}`).toBeLessThanOrEqual(1);
        if (count(rebooks, 201) === 0) {
          // Everyone looked before the cancellation landed; the next attempt
          // must succeed for exactly one of them.
          const retry = await Promise.all(
            users.slice(1).map((u) => u.create(input({ bookingDate, startMin: 660 }))),
          );
          expect(codes(retry), `round ${round} retry`).toEqual([201, 409, 409, 409]);
        }
        const live = (await users[0].list("gold", bookingDate)).body.bookings!.filter(
          (b) => b.status !== "cancelled" && b.startMin === 660,
        );
        expect(live, `round ${round}`).toHaveLength(1);
      }
    });

    it("five cancelled bookings of one slot revived at once: one comes back, four are refused", async () => {
      const cancelled: BookingDTO[] = [];
      for (const u of users) {
        const booking = await create(u, { startMin: 1020 });
        expect((await u.cancel(booking.id)).status).toBe(200);
        cancelled.push(booking);
      }
      const results = await Promise.all(
        users.map((u, i) => u.update(cancelled[i].id, { status: "confirmed" })),
      );
      expect(codes(results)).toEqual([200, 409, 409, 409, 409]);
    });

    it("done, cancel, confirm, note and rename land on one booking at once without an error", async () => {
      for (let round = 0; round < 10; round += 1) {
        const booking = await create(users[0], { bookingDate: futureDate(5 + round), startMin: 720 });
        const results = await Promise.all([
          users[0].update(booking.id, { status: "done" }),
          users[1].cancel(booking.id),
          users[2].update(booking.id, { status: "confirmed" }),
          users[3].update(booking.id, { notes: `note ${round}` }),
          users[4].update(booking.id, { clientName: `Renommée ${round}` }),
        ]);
        expect(codes(results), `round ${round}`).toEqual([200, 200, 200, 200, 200]);
        const row = (await users[0].list("gold", futureDate(5 + round))).body.bookings!.find(
          (b) => b.id === booking.id,
        )!;
        expect(["confirmed", "done", "cancelled"]).toContain(row.status);
        expect(row.notes).toBe(`note ${round}`);
        expect(row.clientName).toBe(`Renommée ${round}`);
      }
    });

    it("five users rename the same booking at once: every save succeeds, one name wins", async () => {
      const booking = await create(users[0], { startMin: 780 });
      const names = users.map((u) => `Nom par ${u.name}`);
      const results = await Promise.all(
        users.map((u, i) => u.update(booking.id, { clientName: names[i] })),
      );
      expect(codes(results)).toEqual([200, 200, 200, 200, 200]);
      const row = (await users[0].list("gold", DAY)).body.bookings!.find((b) => b.id === booking.id)!;
      expect(names).toContain(row.clientName);
    });

    it("two users swap the services of two simultaneous bookings at the same instant", async () => {
      for (let round = 0; round < 25; round += 1) {
        const bookingDate = futureDate(5 + round);
        const startMin = 600;
        const a = await create(users[0], { bookingDate, startMin, service: "Manucure Simple" });
        const b = await create(users[1], { bookingDate, startMin, service: "Pédicure SPA" });
        const results = await Promise.all([
          users[0].update(a.id, { service: "Pédicure SPA" }),
          users[1].update(b.id, { service: "Manucure Simple" }),
        ]);
        for (const r of results) expect([200, 409], `round ${round}`).toContain(r.status);
        // A true swap needs one to land first, which would conflict — so at
        // most one can succeed.
        expect(count(results, 200), `round ${round}`).toBeLessThanOrEqual(1);
      }
    });

    it("two users stretch two neighbouring bookings into each other at the same instant", async () => {
      for (let round = 0; round < 25; round += 1) {
        const bookingDate = futureDate(5 + round);
        // 10:00–10:30 and 11:00–11:30, with a free half hour between them.
        const a = await create(users[0], { bookingDate, startMin: 600, durationMin: 30 });
        const b = await create(users[1], { bookingDate, startMin: 660, durationMin: 30 });
        // Either change alone fills the gap; together they overlap at 10:30.
        const results = await Promise.all([
          users[0].update(a.id, { durationMin: 60 }),
          users[1].update(b.id, { startMin: 630 }),
        ]);
        for (const r of results) expect([200, 409], `round ${round}`).toContain(r.status);
        // Each change is fine on its own; only the pair collides, so exactly
        // one of them must land.
        expect(count(results, 200), `round ${round}`).toBe(1);
      }
    });
  });

  describe(`${label}: live calendar stays true for every screen`, () => {
    it("five screens polling while five users write converge on exactly the database's day", async () => {
      const salon = salons.gold;
      const viewers = makeUsers(transport, 5).map((viewer) => ({
        viewer,
        watermark: undefined as string | undefined,
        rows: [] as BookingDTO[],
      }));

      const poll = async (v: (typeof viewers)[number]) => {
        const res = await v.viewer.watermark("gold", DAY, v.watermark);
        expect(res.status).toBe(200);
        if (res.body.changed) {
          if (res.body.bookings) {
            v.rows = res.body.bookings;
          } else {
            v.rows = (await v.viewer.list("gold", DAY)).body.bookings!;
          }
        }
        v.watermark = res.body.watermark;
        return res.body.changed;
      };

      let writing = true;
      const polling = viewers.map(async (v, i) => {
        const jitter = prng(500 + i);
        while (writing) {
          await poll(v);
          await new Promise((r) => setTimeout(r, jitter.int(0, 8)));
        }
      });

      const services = ["Manucure Simple", "Pédicure SPA", "Coupe"];
      const slots = slotsForSalon(salon);
      const writers = users.map(async (u, i) => {
        const random = prng(1000 + i);
        const mine: BookingDTO[] = [];
        for (let op = 0; op < 30; op += 1) {
          const roll = random.next();
          if (roll < 0.5 || mine.length === 0) {
            const res = await u.create(
              input({ startMin: random.pick(slots.slice(0, -4)), service: random.pick(services) }),
            );
            if (res.status === 201) mine.push(res.body.booking!);
          } else if (roll < 0.8) {
            const target = random.pick(mine);
            await u.update(target.id, {
              clientName: `Edit ${i}-${op}`,
              startMin: random.pick(slots.slice(0, -4)),
            });
          } else if (roll < 0.9) {
            await u.cancel(random.pick(mine).id);
          } else {
            await u.update(random.pick(mine).id, { status: random.pick(["done", "confirmed"]) });
          }
        }
      });

      await Promise.all(writers);
      writing = false;
      await Promise.all(polling);

      // Quiesced. One more poll each — which is all a real screen would get.
      await Promise.all(viewers.map((v) => poll(v)));
      const truth = canonical((await users[0].list("gold", DAY)).body.bookings!);
      for (const v of viewers) {
        expect(canonical(v.rows), `${v.viewer.name} is showing a stale day`).toEqual(truth);
        expect(await poll(v)).toBe(false);
      }
    });
  });

  describe(`${label}: a realistic shift`, () => {
    it("five agents each place 25 client requests, retrying the next free slot on a refusal like a person would", async () => {
      const services = ["Manucure Simple", "Pédicure SPA", "Coloration Basic"];
      const outcomes = await Promise.all(
        users.map(async (agent, i) => {
          const random = prng(42 + i);
          const booked: BookingDTO[] = [];
          let refusals = 0;
          for (let request = 0; request < 25; request += 1) {
            const salonSlug = random.pick(["vip", "gold", "barber"] as const);
            const salon = salons[salonSlug];
            const bookingDate = futureDate(5 + random.int(0, 1));
            const service = random.pick(services);
            const durationMin = random.pick([30, 60, 90]);
            const slots = slotsForSalon(salon).filter((s) => s + durationMin <= salon.closesAtMin);
            let wanted = random.pick(slots);

            for (let attempt = 0; attempt < 12; attempt += 1) {
              const day = (await agent.list(salonSlug, bookingDate)).body.bookings!;
              // What the booking sheet does: skip anything it already knows is taken.
              const free = slots.filter(
                (s) => s >= wanted && !conflictsWithExisting({ startMin: s, durationMin, service }, day),
              );
              if (free.length === 0) break;
              wanted = free[0];
              const res = await agent.create(
                bookingInput({ salonSlug, bookingDate, startMin: wanted, durationMin, service, channel: "call_center" }),
              );
              if (res.status === 201) {
                booked.push(res.body.booking!);
                break;
              }
              expect(res.status).toBe(409);
              refusals += 1;
            }
          }
          return { booked, refusals };
        }),
      );

      const allBooked = outcomes.flatMap((o) => o.booked);
      expect(new Set(allBooked.map((b) => b.id)).size).toBe(allBooked.length);
      for (const slug of ["vip", "gold", "barber"] as const) {
        for (const offset of [0, 1]) {
          const date = futureDate(5 + offset);
          const rows = (await users[0].list(slug, date)).body.bookings!;
          const mine = allBooked.filter((b) => b.salonId === salons[slug].id && b.bookingDate === date);
          expect(canonical(rows)).toEqual(canonical(mine));
        }
      }
    });

    it("200 bookings on distinct slots from five users at once all succeed", async () => {
      const started = Date.now();
      const latencies: number[] = [];
      await Promise.all(
        users.map(async (u, i) => {
          const salonSlug = REAL_SALONS[i % 3].slug;
          const salon = salons[salonSlug];
          const slots = slotsForSalon(salon);
          await Promise.all(
            Array.from({ length: 40 }, async (_, j) => {
              const t0 = Date.now();
              const res = await u.create(
                bookingInput({
                  salonSlug,
                  bookingDate: futureDate(5 + i),
                  startMin: slots[j % slots.length],
                  service: `Service ${Math.floor(j / slots.length)}`,
                }),
              );
              latencies.push(Date.now() - t0);
              expect(res.status).toBe(201);
            }),
          );
        }),
      );
      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      console.info(`[${label}] 200 concurrent creates in ${Date.now() - started} ms, p95 ${p95} ms`);
      expect(latencies).toHaveLength(200);
    });
  });

  describe(`${label}: randomized operations checked against an independent model`, () => {
    function modelFor(): BookingModel {
      return new BookingModel(
        REAL_SALONS.map((s) => ({ ...s, id: salons[s.slug].id })),
      );
    }

    const SERVICES = ["Manucure Simple", "Pédicure SPA", "Coupe", "coupe", " Coupe "];
    const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 4, 481];

    function randomBody(random: ReturnType<typeof prng>, dates: string[]) {
      const salonSlug = random.chance(0.03) ? "platinum" : random.pick(["vip", "gold", "barber"]);
      const salon = REAL_SALONS.find((s) => s.slug === salonSlug) ?? REAL_SALONS[0];
      const body: Record<string, unknown> = {
        salonSlug,
        clientName: random.chance(0.04) ? random.pick(["A", "   "]) : `Cliente ${random.int(1, 999)}`,
        clientPhone: random.chance(0.04) ? random.pick(["123", "06 12"]) : random.chance(0.3) ? "+212 6 12 34 56 78" : nextPhone(),
        bookingDate: random.chance(0.03) ? random.pick(["2020-01-01", "2030-02-30"]) : random.pick(dates),
        startMin: salon.opensAtMin - 30 + random.int(0, Math.floor((salon.closesAtMin - salon.opensAtMin + 30) / 15)) * 15,
        durationMin: random.pick(DURATIONS),
        service: random.pick(SERVICES),
        channel: random.pick(["call_center", "front_desk"]),
      };
      if (random.chance(0.3)) body.notes = random.pick(["", "  note  ", "allergie"]);
      return body;
    }

    function randomPatch(random: ReturnType<typeof prng>, dates: string[]) {
      const patch: Record<string, unknown> = {};
      if (random.chance(0.3)) patch.startMin = 540 + random.int(-2, 30) * 15;
      if (random.chance(0.2)) patch.durationMin = random.pick(DURATIONS);
      if (random.chance(0.1)) patch.bookingDate = random.pick(dates);
      if (random.chance(0.15)) patch.service = random.pick(SERVICES);
      if (random.chance(0.25)) patch.status = random.pick(["confirmed", "done", "cancelled"]);
      if (random.chance(0.15)) patch.notes = random.pick(["", "modifiée"]);
      if (random.chance(0.1)) patch.clientName = random.pick(["Nouveau Nom", "Z"]);
      if (random.chance(0.05)) patch.clientPhone = random.pick(["07 11 22 33 44", "99"]);
      return patch;
    }

    it("1,000 sequential operations by five users match the model response for response", async () => {
      const model = modelFor();
      const random = prng(8675309);
      const dates = [futureDate(5), futureDate(6)];
      const unknownId = "5f1b0c1e-8d2a-4c1b-9e7f-000000000000";

      for (let step = 0; step < 1000; step += 1) {
        const user = users[step % users.length];
        const ids = [...model.bookings.keys()];
        const roll = random.next();

        if (roll < 0.55 || ids.length === 0) {
          const body = randomBody(random, dates);
          const expected = model.predictCreate(body);
          const res = await user.create(body);
          expect(res.status, `step ${step} create ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(expected.status);
          if (expected.status === 201) {
            const stored = res.body.booking!;
            expect({ ...stored, id: expected.booking.id }, `step ${step}`).toEqual(expected.booking);
            model.commitCreate({ ...expected.booking, id: stored.id });
          }
        } else if (roll < 0.85) {
          const id = random.chance(0.03) ? unknownId : random.pick(ids);
          const patch = randomPatch(random, dates);
          const expected = model.predictUpdate(id, patch);
          const res = await user.update(id, patch);
          expect(res.status, `step ${step} update ${id} ${JSON.stringify(patch)}: ${JSON.stringify(res.body)}`).toBe(expected.status);
          if (expected.status === 200) {
            expect(res.body.booking, `step ${step}`).toEqual(expected.booking);
            model.commitUpdate(expected.booking);
          }
        } else {
          const id = random.chance(0.03) ? unknownId : random.pick(ids);
          const expected = model.predictCancel(id);
          const res = await user.cancel(id);
          expect(res.status, `step ${step} cancel ${id}`).toBe(expected.status);
          if (expected.status === 200) {
            expect(res.body.booking, `step ${step}`).toEqual(expected.booking);
            model.commitUpdate(expected.booking);
          }
        }

        if (step % 100 === 99) {
          for (const slug of ["vip", "gold", "barber"] as const) {
            for (const date of dates) {
              const rows = (await user.list(slug, date)).body.bookings!;
              expect(canonical(rows), `step ${step} ${slug} ${date}`).toEqual(model.day(salons[slug].id, date));
            }
          }
        }
      }
    });

    it("five users × 80 random operations concurrently: every invariant holds afterwards", async () => {
      const dates = [futureDate(5), futureDate(6)];
      const created = new Map<string, BookingDTO>();

      await Promise.all(
        users.map(async (user, i) => {
          const random = prng(31337 + i);
          const mine: string[] = [];
          for (let op = 0; op < 80; op += 1) {
            const roll = random.next();
            if (roll < 0.55 || mine.length === 0) {
              const res = await user.create(randomBody(random, dates));
              expect([201, 400, 409]).toContain(res.status);
              if (res.status === 201) {
                mine.push(res.body.booking!.id);
                created.set(res.body.booking!.id, res.body.booking!);
              }
            } else if (roll < 0.85) {
              const res = await user.update(random.pick(mine), randomPatch(random, dates));
              expect([200, 400, 409]).toContain(res.status);
            } else if (roll < 0.95) {
              expect((await user.cancel(random.pick(mine))).status).toBe(200);
            } else {
              const res = await user.list(random.pick(["vip", "gold", "barber"]), random.pick(dates));
              expect(res.status).toBe(200);
            }
          }
        }),
      );

      // Every booking any user was told exists does exist, and nothing else does.
      const everything: BookingDTO[] = [];
      for (const slug of ["vip", "gold", "barber"] as const) {
        for (const date of [...dates, futureDate(7)]) {
          everything.push(...(await users[0].list(slug, date)).body.bookings!);
        }
      }
      const listedIds = new Set(everything.map((b) => b.id));
      for (const id of created.keys()) {
        // A booking can only leave these days by being moved to one of them.
        expect(listedIds.has(id), `booking ${id} was confirmed to a user but is gone`).toBe(true);
      }
      expect(everything.length).toBe(created.size);
    });
  });
}

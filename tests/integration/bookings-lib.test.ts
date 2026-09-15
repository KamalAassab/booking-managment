import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

import { bookings, type Salon } from "@/db/schema";
import {
  NotFoundError,
  SlotTakenError,
  ValidationError,
  bookingsWatermark,
  cancelBooking,
  countBookingsInRange,
  createBooking,
  getBookingById,
  getSalonBySlug,
  listBookings,
  listBookingsForSalons,
  listBookingsInRange,
  listSalons,
  updateBooking,
} from "@/lib/bookings";
import { todayInSalonTz } from "@/lib/time";
import type { CreateBookingInput } from "@/lib/validation";

import { db, describeIfDb, insertBookingRaw } from "../helpers/db";
import {
  closeDb,
  findDoubleBookings,
  futureDate,
  nextPhone,
  resetWithRealSalons,
} from "../helpers/fixtures";

/**
 * src/lib/bookings.ts against a real database: every rule the agent can run
 * into while a client waits on the phone, and the translation of database
 * refusals into the three domain errors the API turns into 400/404/409.
 */

const DAY = futureDate(10);

function input(overrides: Partial<CreateBookingInput> = {}): CreateBookingInput {
  return {
    salonSlug: "vip",
    clientName: "Sarah Benali",
    clientPhone: nextPhone(),
    bookingDate: DAY,
    startMin: 600,
    durationMin: 30,
    service: "Manucure Simple",
    notes: undefined,
    channel: "front_desk",
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection, but the call succeeded");
    },
    (error: unknown) => error,
  );
}

let salons: Record<"vip" | "gold" | "barber", Salon>;

beforeEach(async () => {
  salons = await resetWithRealSalons();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(closeDb);

describeIfDb("driver", () => {
  it("is the one this run asked for (TEST_NEON_HTTP=1 means production's Neon HTTP driver)", async () => {
    const { driverFor } = await import("@/db");
    expect(driverFor(process.env.DATABASE_URL!)).toBe(
      process.env.TEST_NEON_HTTP === "1" ? "neon-http" : "node-postgres",
    );
  });
});

describeIfDb("salons", () => {
  it("lists salons in their configured order", async () => {
    const rows = await listSalons();
    expect(rows.map((s) => s.slug)).toEqual(["vip", "gold", "barber"]);
  });

  it("finds a salon by slug and returns null for anything else", async () => {
    expect((await getSalonBySlug("gold"))?.id).toBe(salons.gold.id);
    expect(await getSalonBySlug("nope")).toBeNull();
    expect(await getSalonBySlug("")).toBeNull();
  });
});

describeIfDb("createBooking", () => {
  it("stores a normalised, trimmed booking and returns its salon", async () => {
    const { booking, salon } = await createBooking(
      input({
        clientName: "  Sarah Benali  ",
        clientPhone: "06 12 34 56 78",
        service: "  Manucure Simple ",
        notes: "  allergie au latex ",
        channel: "call_center",
      }),
    );
    expect(salon.slug).toBe("vip");
    expect(booking).toMatchObject({
      salonId: salons.vip.id,
      clientName: "Sarah Benali",
      clientPhone: "+212612345678",
      bookingDate: DAY,
      startMin: 600,
      durationMin: 30,
      service: "Manucure Simple",
      notes: "allergie au latex",
      status: "confirmed",
      channel: "call_center",
    });
    expect((await getBookingById(booking.id))?.clientPhone).toBe("+212612345678");
  });

  it("stores no note as null rather than an empty string", async () => {
    const { booking } = await createBooking(input({ notes: undefined }));
    expect(booking.notes).toBeNull();
  });

  it("rejects an unknown salon", async () => {
    const error = await rejection(createBooking(input({ salonSlug: "platinum" })));
    expect(error).toBeInstanceOf(ValidationError);
  });

  it("rejects a phone number that belongs to nobody", async () => {
    for (const clientPhone of ["12", "06 12 34", "+212 0812345678", "abc", "0912345678"]) {
      const error = await rejection(createBooking(input({ clientPhone })));
      expect(error, clientPhone).toBeInstanceOf(ValidationError);
    }
  });

  it("rejects a blank name or service even when the schema was bypassed", async () => {
    expect(await rejection(createBooking(input({ clientName: "   " })))).toBeInstanceOf(ValidationError);
    expect(await rejection(createBooking(input({ service: "  " })))).toBeInstanceOf(ValidationError);
  });

  it("rejects an impossible date", async () => {
    expect(await rejection(createBooking(input({ bookingDate: "2030-02-30" })))).toBeInstanceOf(ValidationError);
  });

  it("enforces each salon's own opening hours", async () => {
    // VIP opens at 10:00 and closes at 22:00; Gold opens at 09:00.
    expect(await rejection(createBooking(input({ startMin: 570 })))).toBeInstanceOf(ValidationError);
    expect(await rejection(createBooking(input({ startMin: 1290, durationMin: 60 })))).toBeInstanceOf(ValidationError);
    await createBooking(input({ salonSlug: "gold", startMin: 540 }));
    await createBooking(input({ startMin: 1290, durationMin: 30 })); // ends exactly at closing
  });

  it("rejects a start time off the salon's grid", async () => {
    expect(await rejection(createBooking(input({ startMin: 615 })))).toBeInstanceOf(ValidationError);
    expect(await rejection(createBooking(input({ startMin: 601 })))).toBeInstanceOf(ValidationError);
  });

  it("rejects non-integer or non-positive times", async () => {
    expect(await rejection(createBooking(input({ startMin: 600.5 })))).toBeInstanceOf(ValidationError);
    expect(await rejection(createBooking(input({ durationMin: 0 })))).toBeInstanceOf(ValidationError);
    expect(await rejection(createBooking(input({ durationMin: -30 })))).toBeInstanceOf(ValidationError);
  });

  it("rejects a booking that would run past midnight with a sentence, not a 500", async () => {
    const error = await rejection(createBooking(input({ salonSlug: "gold", startMin: 1350, durationMin: 120 })));
    expect(error).toBeInstanceOf(ValidationError);
  });

  it("accepts today's slot under way, refuses one that has ended, and refuses past days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-06-10T13:10:00Z")); // 14:10 in Casablanca
    const today = todayInSalonTz();
    expect(today).toBe("2031-06-10");
    await createBooking(input({ salonSlug: "gold", bookingDate: today, startMin: 840 }));
    expect(
      await rejection(createBooking(input({ salonSlug: "gold", bookingDate: today, startMin: 810 }))),
    ).toBeInstanceOf(ValidationError);
    expect(
      await rejection(createBooking(input({ salonSlug: "gold", bookingDate: "2031-06-09", startMin: 900 }))),
    ).toBeInstanceOf(ValidationError);
  });

  it("throws SlotTakenError for the same service on the same minutes", async () => {
    await createBooking(input());
    const error = await rejection(createBooking(input()));
    expect(error).toBeInstanceOf(SlotTakenError);
    expect((error as Error).message).toMatch(/réservé/);
  });

  it("throws SlotTakenError for an overlapping range of the same service", async () => {
    await createBooking(input({ startMin: 600, durationMin: 90 }));
    expect(await rejection(createBooking(input({ startMin: 660, durationMin: 30 })))).toBeInstanceOf(SlotTakenError);
  });

  it("accepts different services at the same time", async () => {
    await createBooking(input({ service: "Manucure Simple" }));
    await createBooking(input({ service: "Pédicure SPA" }));
    await createBooking(input({ service: "Hammam VIP" }));
    expect(await listBookings(salons.vip.id, DAY)).toHaveLength(3);
  });

  it("allows the same client to hold two different services back to back or at once", async () => {
    const phone = nextPhone();
    await createBooking(input({ clientPhone: phone, service: "Manucure Simple", startMin: 600 }));
    await createBooking(input({ clientPhone: phone, service: "Pédicure SPA", startMin: 600 }));
    await createBooking(input({ clientPhone: phone, service: "Manucure Simple", startMin: 630 }));
  });
});

describeIfDb("updateBooking", () => {
  it("returns null for a booking that does not exist", async () => {
    expect(await updateBooking("5f1b0c1e-8d2a-4c1b-9e7f-000000000000", { clientName: "X Y" })).toBeNull();
  });

  it("updates details without touching the time", async () => {
    const { booking } = await createBooking(input());
    const updated = await updateBooking(booking.id, {
      clientName: "Nadia Alaoui",
      clientPhone: "+212 7 12 34 56 78",
      notes: "arrive 5 min en avance",
    });
    expect(updated).toMatchObject({
      clientName: "Nadia Alaoui",
      clientPhone: "+212712345678",
      notes: "arrive 5 min en avance",
      startMin: 600,
    });
  });

  it("clears a note when the agent empties the field", async () => {
    const { booking } = await createBooking(input({ notes: "ancienne note" }));
    // The booking sheet always sends the note it is showing. An emptied
    // field arrives as "", which must remove the note — not keep it.
    const { updateBookingSchema } = await import("@/lib/validation");
    const parsed = updateBookingSchema.parse({ notes: "" });
    const updated = await updateBooking(booking.id, parsed);
    expect(updated?.notes).toBeNull();
    expect((await getBookingById(booking.id))?.notes).toBeNull();
  });

  it("keeps a note when the patch does not mention notes at all", async () => {
    const { booking } = await createBooking(input({ notes: "garder" }));
    const updated = await updateBooking(booking.id, { clientName: "Autre Nom" });
    expect(updated?.notes).toBe("garder");
  });

  it("does not bump updated_at for an empty patch", async () => {
    const { booking } = await createBooking(input());
    const before = await getBookingById(booking.id);
    const same = await updateBooking(booking.id, {});
    expect(same?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
  });

  it("moves a booking to a free slot", async () => {
    const { booking } = await createBooking(input());
    const moved = await updateBooking(booking.id, { startMin: 720, durationMin: 60 });
    expect(moved).toMatchObject({ startMin: 720, durationMin: 60 });
  });

  it("moves a booking to another day", async () => {
    const { booking } = await createBooking(input());
    const other = futureDate(11);
    const moved = await updateBooking(booking.id, { bookingDate: other });
    expect(moved?.bookingDate).toBe(other);
    expect(await listBookings(salons.vip.id, DAY)).toHaveLength(0);
    expect(await listBookings(salons.vip.id, other)).toHaveLength(1);
  });

  it("does not conflict with itself when extended over its own minutes", async () => {
    const { booking } = await createBooking(input({ startMin: 600, durationMin: 30 }));
    const longer = await updateBooking(booking.id, { durationMin: 90 });
    expect(longer?.durationMin).toBe(90);
    const shifted = await updateBooking(booking.id, { startMin: 630 });
    expect(shifted?.startMin).toBe(630);
  });

  it("throws SlotTakenError when moved onto the same service", async () => {
    await createBooking(input({ startMin: 600 }));
    const { booking } = await createBooking(input({ startMin: 720 }));
    expect(await rejection(updateBooking(booking.id, { startMin: 600 }))).toBeInstanceOf(SlotTakenError);
    expect((await getBookingById(booking.id))?.startMin).toBe(720);
  });

  it("throws SlotTakenError when extended into the next booking of the same service", async () => {
    await createBooking(input({ startMin: 660 }));
    const { booking } = await createBooking(input({ startMin: 600 }));
    expect(await rejection(updateBooking(booking.id, { durationMin: 90 }))).toBeInstanceOf(SlotTakenError);
  });

  it("throws SlotTakenError when the service is changed into one already booked then", async () => {
    await createBooking(input({ service: "Pédicure SPA" }));
    const { booking } = await createBooking(input({ service: "Manucure Simple" }));
    expect(await rejection(updateBooking(booking.id, { service: "Pédicure SPA" }))).toBeInstanceOf(SlotTakenError);
  });

  it("re-checks opening hours whenever the booking moves", async () => {
    const { booking } = await createBooking(input());
    expect(await rejection(updateBooking(booking.id, { startMin: 540 }))).toBeInstanceOf(ValidationError);
    expect(await rejection(updateBooking(booking.id, { startMin: 1290, durationMin: 60 }))).toBeInstanceOf(ValidationError);
    expect(await rejection(updateBooking(booking.id, { startMin: 615 }))).toBeInstanceOf(ValidationError);
    // Extending only the duration past closing is still a move in time.
    const { booking: late } = await createBooking(input({ startMin: 1260 }));
    expect(await rejection(updateBooking(late.id, { durationMin: 90 }))).toBeInstanceOf(ValidationError);
  });

  it("rejects an invalid phone or blank name on update", async () => {
    const { booking } = await createBooking(input());
    expect(await rejection(updateBooking(booking.id, { clientPhone: "123" }))).toBeInstanceOf(ValidationError);
    expect(await rejection(updateBooking(booking.id, { clientName: "  " }))).toBeInstanceOf(ValidationError);
    expect(await rejection(updateBooking(booking.id, { service: " " }))).toBeInstanceOf(ValidationError);
    expect(await rejection(updateBooking(booking.id, { bookingDate: "2030-13-01" }))).toBeInstanceOf(ValidationError);
  });

  it("marks done and back to confirmed without any conflict check tripping", async () => {
    const { booking } = await createBooking(input());
    expect((await updateBooking(booking.id, { status: "done" }))?.status).toBe("done");
    expect((await updateBooking(booking.id, { status: "confirmed" }))?.status).toBe("confirmed");
  });

  it("revives a cancelled booking when its slot is still free", async () => {
    const { booking } = await createBooking(input());
    await cancelBooking(booking.id);
    expect((await updateBooking(booking.id, { status: "confirmed" }))?.status).toBe("confirmed");
  });

  it("refuses to revive a cancelled booking onto a slot someone has since taken", async () => {
    const { booking } = await createBooking(input());
    await cancelBooking(booking.id);
    await createBooking(input());
    expect(await rejection(updateBooking(booking.id, { status: "confirmed" }))).toBeInstanceOf(SlotTakenError);
    expect(await rejection(updateBooking(booking.id, { status: "done" }))).toBeInstanceOf(SlotTakenError);
    expect((await getBookingById(booking.id))?.status).toBe("cancelled");
  });

  it("refuses to revive a booking whose time now falls outside opening hours", async () => {
    const booking = await insertBookingRaw({
      salonId: salons.vip.id,
      bookingDate: DAY,
      startMin: 540, // 09:00, before VIP's 10:00 opening
      status: "cancelled",
      service: "Manucure Simple",
    });
    expect(await rejection(updateBooking(booking.id, { status: "confirmed" }))).toBeInstanceOf(ValidationError);
  });

  it("raises NotFoundError rather than skipping the hours check when the salon row is gone", async () => {
    const { booking } = await createBooking(input());
    await db.execute(sql`alter table bookings drop constraint bookings_salon_id_salons_id_fk`);
    try {
      await db.execute(sql`delete from salons where id = ${salons.vip.id}`);
      expect(await rejection(updateBooking(booking.id, { startMin: 630 }))).toBeInstanceOf(NotFoundError);
    } finally {
      await db.execute(sql`delete from bookings`);
      await db.execute(sql`
        alter table bookings add constraint bookings_salon_id_salons_id_fk
        foreign key (salon_id) references salons(id) on delete restrict
      `);
    }
  });
});

describeIfDb("cancelBooking", () => {
  it("soft-cancels, keeps the row, and frees the slot", async () => {
    const { booking } = await createBooking(input());
    const cancelled = await cancelBooking(booking.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(await getBookingById(booking.id)).not.toBeNull();
    await createBooking(input());
  });

  it("returns null for an unknown booking", async () => {
    expect(await cancelBooking("5f1b0c1e-8d2a-4c1b-9e7f-000000000000")).toBeNull();
  });

  it("is idempotent and does not bump updated_at the second time", async () => {
    const { booking } = await createBooking(input());
    const first = await cancelBooking(booking.id);
    const second = await cancelBooking(booking.id);
    expect(second?.status).toBe("cancelled");
    expect(second?.updatedAt.getTime()).toBe(first?.updatedAt.getTime());
  });

  it("can cancel a booking marked done", async () => {
    const { booking } = await createBooking(input());
    await updateBooking(booking.id, { status: "done" });
    expect((await cancelBooking(booking.id))?.status).toBe("cancelled");
  });
});

describeIfDb("listing queries", () => {
  it("lists one salon's day in start order, cancelled rows included", async () => {
    const late = await createBooking(input({ startMin: 900 }));
    await createBooking(input({ startMin: 600 }));
    await createBooking(input({ startMin: 600, service: "Pédicure SPA" }));
    await cancelBooking(late.booking.id);
    await createBooking(input({ salonSlug: "gold", startMin: 600 }));
    await createBooking(input({ bookingDate: futureDate(12), startMin: 600 }));

    const rows = await listBookings(salons.vip.id, DAY);
    expect(rows.map((r) => r.startMin)).toEqual([600, 600, 900]);
    expect(rows.find((r) => r.startMin === 900)?.status).toBe("cancelled");
  });

  it("lists several salons at once for the owner screen", async () => {
    await createBooking(input({ salonSlug: "vip" }));
    await createBooking(input({ salonSlug: "gold" }));
    await createBooking(input({ salonSlug: "barber", service: "Coupe Homme" }));
    expect(await listBookingsForSalons([salons.vip.id, salons.gold.id, salons.barber.id], DAY)).toHaveLength(3);
    expect(await listBookingsForSalons([salons.gold.id], DAY)).toHaveLength(1);
    expect(await listBookingsForSalons([], DAY)).toEqual([]);
  });

  it("lists and counts a date range without cancelled rows", async () => {
    const d1 = futureDate(20);
    const d2 = futureDate(21);
    const d3 = futureDate(40);
    await createBooking(input({ bookingDate: d1 }));
    const gone = await createBooking(input({ bookingDate: d2 }));
    await createBooking(input({ bookingDate: d2, startMin: 660 }));
    await createBooking(input({ bookingDate: d3 }));
    await cancelBooking(gone.booking.id);

    const inRange = await listBookingsInRange(salons.vip.id, d1, d2);
    expect(inRange.map((b) => [b.bookingDate, b.startMin])).toEqual([
      [d1, 600],
      [d2, 660],
    ]);
    expect(await countBookingsInRange(salons.vip.id, d1, d2)).toBe(2);
    expect(await countBookingsInRange(salons.vip.id, d1, d3)).toBe(3);
  });
});

describeIfDb("bookingsWatermark (live-update change detection)", () => {
  it("is stable while nothing changes", async () => {
    await createBooking(input());
    const a = await bookingsWatermark([salons.vip.id], DAY);
    const b = await bookingsWatermark([salons.vip.id], DAY);
    expect(a).toBe(b);
  });

  it("returns a fixed value for an empty salon list", async () => {
    expect(await bookingsWatermark([], DAY)).toBe(await bookingsWatermark([], DAY));
  });

  it("changes on create, edit, status change, cancel and move", async () => {
    let previous = await bookingsWatermark([salons.vip.id], DAY);
    const expectChanged = async (step: string) => {
      const next = await bookingsWatermark([salons.vip.id], DAY);
      expect(next, `watermark did not move after: ${step}`).not.toBe(previous);
      previous = next;
    };
    const { booking } = await createBooking(input());
    await expectChanged("create");
    await updateBooking(booking.id, { clientName: "Nom Modifié" });
    await expectChanged("rename");
    await updateBooking(booking.id, { notes: "note" });
    await expectChanged("note");
    await updateBooking(booking.id, { status: "done" });
    await expectChanged("done");
    await updateBooking(booking.id, { status: "confirmed" });
    await expectChanged("confirmed again");
    await cancelBooking(booking.id);
    await expectChanged("cancel");
    await updateBooking(booking.id, { bookingDate: futureDate(11) });
    await expectChanged("move to another day");
  });

  it("changes on every one of many rapid consecutive edits", async () => {
    const { booking } = await createBooking(input());
    let previous = await bookingsWatermark([salons.vip.id], DAY);
    for (let i = 0; i < 20; i += 1) {
      await updateBooking(booking.id, { clientName: `Nom ${i}` });
      const next = await bookingsWatermark([salons.vip.id], DAY);
      expect(next, `edit ${i} went unnoticed`).not.toBe(previous);
      previous = next;
    }
  });

  it("is not moved by changes to another salon or another day", async () => {
    const before = await bookingsWatermark([salons.vip.id], DAY);
    await createBooking(input({ salonSlug: "gold" }));
    await createBooking(input({ bookingDate: futureDate(11) }));
    expect(await bookingsWatermark([salons.vip.id], DAY)).toBe(before);
  });

  it("notices an edit even when the server's clock is behind the database's", async () => {
    // Vercel functions and the Neon compute keep separate clocks. Inserts are
    // stamped by the database (defaultNow) and edits by the function
    // (new Date()), so a function a couple of seconds slow writes an
    // updated_at older than the day's newest row.
    const { booking } = await createBooking(input({ startMin: 600 }));
    // The newest row, which holds the day's max(updated_at).
    await createBooking(input({ startMin: 660 }));
    const before = await bookingsWatermark([salons.vip.id], DAY);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() - 5_000));
    await updateBooking(booking.id, { clientName: "Modifiée Ailleurs" });
    vi.useRealTimers();

    expect(await bookingsWatermark([salons.vip.id], DAY)).not.toBe(before);
  });

  it("notices a write that commits after a later one has already been seen", async () => {
    // Two agents save at once. The first request stamps its row, is delayed
    // on the network, and commits after the second — which a poll has
    // already observed. A newest-timestamp watermark sees nothing new.
    const { booking: a } = await createBooking(input({ startMin: 600 }));
    const { booking: b } = await createBooking(input({ startMin: 660 }));

    const slowStamp = new Date();
    await new Promise((r) => setTimeout(r, 15));
    await updateBooking(b.id, { clientName: "Second Enregistré" });
    const seenByPoll = await bookingsWatermark([salons.vip.id], DAY);

    await db
      .update(bookings)
      .set({ clientName: "Premier Enregistré", updatedAt: slowStamp })
      .where(eq(bookings.id, a.id));

    expect(await bookingsWatermark([salons.vip.id], DAY)).not.toBe(seenByPoll);
  });

  it("notices a change committed by a transaction that started earlier", async () => {
    const { booking: a } = await createBooking(input({ startMin: 600 }));
    const { booking: b } = await createBooking(input({ startMin: 660 }));
    // A connection of its own, whichever driver the app is using, to hold a
    // transaction open across the other write.
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    const slow = await pool.connect();
    try {
      await slow.query("begin");
      // now() inside this transaction is fixed at its start.
      await slow.query("update bookings set client_name = 'Lent', updated_at = now() where id = $1", [a.id]);
      await new Promise((r) => setTimeout(r, 15));
      await db.execute(sql`update bookings set client_name = 'Rapide', updated_at = now() where id = ${b.id}`);
      const seenByPoll = await bookingsWatermark([salons.vip.id], DAY);
      await slow.query("commit");
      expect(await bookingsWatermark([salons.vip.id], DAY)).not.toBe(seenByPoll);
    } finally {
      slow.release();
      await pool.end();
    }
  });

  it("covers several salons at once", async () => {
    const ids = [salons.vip.id, salons.gold.id];
    const before = await bookingsWatermark(ids, DAY);
    await createBooking(input({ salonSlug: "gold" }));
    expect(await bookingsWatermark(ids, DAY)).not.toBe(before);
  });
});

describeIfDb("transient database failures during a write", () => {
  // A trigger raising a real SQLSTATE, counted by a sequence — sequences are
  // not rolled back with the failed statement, so "fail the first N attempts"
  // is exact. This is how a deadlock between two agents' writes reaches the
  // application, without having to win a microsecond race to produce one.
  // One statement per call: Neon's HTTP endpoint (TEST_NEON_HTTP=1) runs
  // each query as a prepared statement, which cannot hold several.
  async function executeEach(statements: string[]) {
    for (const statement of statements) await db.execute(sql.raw(statement));
  }

  async function failNextWrites(times: number, sqlstate: string) {
    await executeEach([
      "drop sequence if exists test_fault_seq",
      "create sequence test_fault_seq",
      `create or replace function test_inject_fault() returns trigger language plpgsql as $f$
        begin
          if nextval('test_fault_seq') <= ${times} then
            raise exception 'injected failure' using errcode = '${sqlstate}';
          end if;
          return new;
        end $f$`,
      "drop trigger if exists test_inject_fault on bookings",
      `create trigger test_inject_fault before insert or update on bookings
          for each row execute function test_inject_fault()`,
    ]);
  }

  async function attemptsMade(): Promise<number> {
    const result = await db.execute(sql`select last_value::int as n, is_called from test_fault_seq`);
    const row = (result as unknown as { rows: { n: number; is_called: boolean }[] }).rows[0];
    return row.is_called ? row.n : 0;
  }

  afterEach(async () => {
    await executeEach([
      "drop trigger if exists test_inject_fault on bookings",
      "drop function if exists test_inject_fault()",
      "drop sequence if exists test_fault_seq",
    ]);
  });

  it("retries a create through two deadlocks and stores it once", async () => {
    await failNextWrites(2, "40P01");
    const { booking } = await createBooking(input());
    expect(await attemptsMade()).toBe(3);
    expect(await listBookings(salons.vip.id, DAY)).toEqual([booking]);
  });

  it("retries an edit through a serialization failure", async () => {
    const { booking } = await createBooking(input());
    await failNextWrites(1, "40001");
    const updated = await updateBooking(booking.id, { clientName: "Après Nouvel Essai" });
    expect(updated?.clientName).toBe("Après Nouvel Essai");
  });

  it("reports a collision, not a server error, when the database keeps deadlocking", async () => {
    await failNextWrites(100, "40P01");
    expect(await rejection(createBooking(input()))).toBeInstanceOf(SlotTakenError);
    expect(await attemptsMade()).toBe(3);
    expect(await listBookings(salons.vip.id, DAY)).toEqual([]);
  });

  it("does not retry a genuine refusal", async () => {
    await failNextWrites(100, "23514");
    expect(await rejection(createBooking(input()))).toBeInstanceOf(ValidationError);
    expect(await attemptsMade()).toBe(1);
  });

  it("turns text the database cannot store into a sentence, not a 500", async () => {
    expect(await rejection(createBooking(input({ notes: "a b" })))).toBeInstanceOf(ValidationError);
  });
});

describeIfDb("library invariants", () => {
  it("never leaves a double booking behind after a mixed sequence", async () => {
    const attempts = [
      input({ startMin: 600, durationMin: 60 }),
      input({ startMin: 630, durationMin: 30 }),
      input({ startMin: 660, durationMin: 30 }),
      input({ startMin: 600, durationMin: 30, service: "Pédicure SPA" }),
      input({ startMin: 615, durationMin: 30, service: "Pédicure SPA" }),
    ];
    for (const attempt of attempts) {
      await createBooking(attempt).catch(() => undefined);
    }
    expect(await findDoubleBookings()).toEqual([]);
  });
});

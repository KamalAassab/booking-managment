import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  changeOwnerPassword,
  changeStaffPassword,
  login,
} from "@/app/actions/auth";
import {
  createServiceAction,
  deleteServiceAction,
  updateServiceAction,
} from "@/app/actions/services";
import type { Salon } from "@/db/schema";
import { hashPassword } from "@/lib/password";
import { resetRateLimits } from "@/lib/rate-limit";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { listServicesForSalon } from "@/lib/services";

import { sessionCookie } from "../helpers/api-client";
import { describeIfDb, makeUser } from "../helpers/db";
import { closeDb, resetWithRealSalons } from "../helpers/fixtures";
import { requestContext } from "../helpers/request-context";

vi.mock("next/headers", () => import("../helpers/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * The server actions behind the login form, the owner's password forms and
 * the owner's service catalogue — each run the way Next.js runs them, with a
 * cookie jar and request headers, against a real database.
 */

type Jar = Map<string, string>;

function asRole(role: "staff" | "owner" | null, headers: Record<string, string> = {}) {
  const cookies: Jar = new Map();
  if (role) {
    const [name, value] = sessionCookie(role).split("=");
    cookies.set(name, value);
  }
  return {
    cookies,
    run: <T>(fn: () => Promise<T>) => requestContext.run({ cookies, headers: new Headers(headers) }, fn),
  };
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

/** redirect() signals by throwing; this returns where it was sending the user. */
async function redirectTarget(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return digest.split(";")[2] ?? "";
  }
}

let salons: Record<"vip" | "gold" | "barber", Salon>;

beforeEach(async () => {
  salons = await resetWithRealSalons();
  resetRateLimits();
});

afterAll(closeDb);

describeIfDb("service catalogue actions", () => {
  const valid = () => ({
    salonId: salons.vip.id,
    category: "Onglerie",
    name: "Soin Test",
    durationMin: "45",
    price: "120",
  });

  it("are owner-only: staff are sent to the planning, strangers to the owner login", async () => {
    expect(await redirectTarget(asRole("staff").run(() => createServiceAction({}, form(valid()))))).toBe("/bookings");
    expect(await redirectTarget(asRole(null).run(() => createServiceAction({}, form(valid()))))).toBe("/login?role=owner");
    expect(await redirectTarget(asRole("staff").run(() => deleteServiceAction({}, form({ id: salons.vip.id }))))).toBe("/bookings");
    expect(await listServicesForSalon(salons.vip.id)).toEqual([]);
  });

  it("creates a service at the end of the list and revalidates both screens", async () => {
    const { revalidatePath } = await import("next/cache");
    const owner = asRole("owner");
    expect(await owner.run(() => createServiceAction({}, form(valid())))).toEqual({ success: true });
    expect(await owner.run(() => createServiceAction({}, form({ ...valid(), name: "Deuxième" })))).toEqual({ success: true });
    const rows = await listServicesForSalon(salons.vip.id);
    expect(rows.map((r) => r.name)).toEqual(["Soin Test", "Deuxième"]);
    expect(revalidatePath).toHaveBeenCalledWith("/owner/services");
    expect(revalidatePath).toHaveBeenCalledWith("/bookings");
  });

  it.each([
    [{ name: "" }, "Nom requis."],
    [{ name: "   " }, "Nom requis."],
    [{ category: "" }, "Catégorie requise."],
    [{ durationMin: "3" }, "Durée minimale : 5 min."],
    [{ durationMin: "481" }, "Durée maximale : 480 min."],
    [{ durationMin: "abc" }, "Durée invalide."],
    [{ price: "-1" }, "Le prix ne peut pas être négatif."],
    [{ price: "12.5" }, "Prix invalide."],
    [{ salonId: "not-a-uuid" }, "Salon introuvable."],
    [{ salonId: "5f1b0c1e-8d2a-4c1b-9e7f-000000000000" }, "Salon introuvable."],
  ])("refuses a new service with %j: %s", async (override, message) => {
    const result = await asRole("owner").run(() => createServiceAction({}, form({ ...valid(), ...override })));
    expect(result).toEqual({ error: message });
    expect(await listServicesForSalon(salons.vip.id)).toEqual([]);
  });

  it("updates one field at a time and explains every refusal", async () => {
    const owner = asRole("owner");
    await owner.run(() => createServiceAction({}, form(valid())));
    const [service] = await listServicesForSalon(salons.vip.id);

    expect(await owner.run(() => updateServiceAction({}, form({ id: service.id, price: "150" })))).toEqual({ success: true });
    expect((await listServicesForSalon(salons.vip.id))[0]).toMatchObject({ price: 150, name: "Soin Test" });

    expect(await owner.run(() => updateServiceAction({}, form({ id: service.id, name: "" })))).toEqual({ error: "Nom requis." });
    expect(await owner.run(() => updateServiceAction({}, form({ id: service.id, durationMin: "2" })))).toEqual({
      error: "Durée minimale : 5 min.",
    });
    expect(await owner.run(() => updateServiceAction({}, form({ id: "nope", price: "1" })))).toEqual({ error: "Service introuvable." });
    expect(
      await owner.run(() => updateServiceAction({}, form({ id: "5f1b0c1e-8d2a-4c1b-9e7f-000000000000", price: "1" }))),
    ).toEqual({ error: "Service introuvable." });
    expect((await listServicesForSalon(salons.vip.id))[0]).toMatchObject({ price: 150, name: "Soin Test", durationMin: 45 });
  });

  it("deletes once, then reports the service as gone; a malformed id is an error, not a crash", async () => {
    const owner = asRole("owner");
    await owner.run(() => createServiceAction({}, form(valid())));
    const [service] = await listServicesForSalon(salons.vip.id);
    expect(await owner.run(() => deleteServiceAction({}, form({ id: service.id })))).toEqual({ success: true });
    expect(await owner.run(() => deleteServiceAction({}, form({ id: service.id })))).toEqual({ error: "Service introuvable." });
    expect(await owner.run(() => deleteServiceAction({}, form({ id: "'; drop table services; --" })))).toEqual({
      error: "Service introuvable.",
    });
    expect(await owner.run(() => deleteServiceAction({}, new FormData()))).toEqual({ error: "Service introuvable." });
  });
});

describeIfDb("login", () => {
  beforeEach(async () => {
    await makeUser("staff", await hashPassword("staff-pass-2026"));
    await makeUser("owner", await hashPassword("owner-pass-2026"));
  });

  it("signs staff in, sets a verifiable staff session and sends them to the planning", async () => {
    const visitor = asRole(null, { "x-forwarded-for": "10.0.0.1" });
    const target = await redirectTarget(
      visitor.run(() => login({}, form({ role: "staff", password: "staff-pass-2026" }))),
    );
    expect(target).toBe("/bookings");
    expect(verifySessionToken(visitor.cookies.get(SESSION_COOKIE))?.role).toBe("staff");
  });

  it("signs the owner in and sends them to the owner screen", async () => {
    const visitor = asRole(null, { "x-forwarded-for": "10.0.0.2" });
    const target = await redirectTarget(
      visitor.run(() => login({}, form({ role: "owner", password: "owner-pass-2026" }))),
    );
    expect(target).toBe("/owner");
    expect(verifySessionToken(visitor.cookies.get(SESSION_COOKIE))?.role).toBe("owner");
  });

  it("refuses a wrong password, the other role's password, and an empty one, without a session", async () => {
    const visitor = asRole(null, { "x-forwarded-for": "10.0.0.3" });
    expect(await visitor.run(() => login({}, form({ role: "staff", password: "wrong" })))).toEqual({ error: "Mot de passe incorrect." });
    expect(await visitor.run(() => login({}, form({ role: "owner", password: "staff-pass-2026" })))).toEqual({
      error: "Mot de passe incorrect.",
    });
    expect(await visitor.run(() => login({}, form({ role: "staff", password: "" })))).toEqual({ error: "Mot de passe requis." });
    expect(visitor.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  it("treats an unknown role as staff rather than escalating", async () => {
    const visitor = asRole(null, { "x-forwarded-for": "10.0.0.4" });
    const target = await redirectTarget(
      visitor.run(() => login({}, form({ role: "admin", password: "staff-pass-2026" }))),
    );
    expect(target).toBe("/bookings");
    expect(verifySessionToken(visitor.cookies.get(SESSION_COOKIE))?.role).toBe("staff");
  });

  it("locks an address out after five wrong passwords, even for the right one, but not other addresses", async () => {
    const attacker = asRole(null, { "x-forwarded-for": "203.0.113.9" });
    for (let i = 0; i < 5; i += 1) {
      expect(await attacker.run(() => login({}, form({ role: "staff", password: `guess-${i}` })))).toEqual({
        error: "Mot de passe incorrect.",
      });
    }
    const locked = await attacker.run(() => login({}, form({ role: "staff", password: "staff-pass-2026" })));
    expect(locked.error).toMatch(/Trop de tentatives/);

    const colleague = asRole(null, { "x-forwarded-for": "198.51.100.7" });
    expect(
      await redirectTarget(colleague.run(() => login({}, form({ role: "staff", password: "staff-pass-2026" })))),
    ).toBe("/bookings");
  });
});

describeIfDb("password changes", () => {
  beforeEach(async () => {
    await makeUser("staff", await hashPassword("staff-pass-2026"));
    await makeUser("owner", await hashPassword("owner-pass-2026"));
  });

  async function canLogin(role: "staff" | "owner", password: string, ip: string) {
    const visitor = asRole(null, { "x-forwarded-for": ip });
    return (await redirectTarget(visitor.run(() => login({}, form({ role, password }))))) !== null;
  }

  describe("shared staff password", () => {
    it("is refused to staff and to strangers", async () => {
      const fields = form({ password: "nouveau-pass", confirm: "nouveau-pass" });
      expect(await asRole("staff").run(() => changeStaffPassword({}, fields))).toEqual({
        error: "Action réservée au propriétaire.",
      });
      expect(await asRole(null).run(() => changeStaffPassword({}, fields))).toEqual({
        error: "Action réservée au propriétaire.",
      });
      expect(await canLogin("staff", "staff-pass-2026", "10.1.0.1")).toBe(true);
    });

    it("validates length and confirmation", async () => {
      const owner = asRole("owner");
      expect((await owner.run(() => changeStaffPassword({}, form({ password: "abc", confirm: "abc" })))).error).toMatch(/au moins 4/);
      expect(await owner.run(() => changeStaffPassword({}, form({ password: "abcdef", confirm: "abcdeg" })))).toEqual({
        error: "Les deux mots de passe diffèrent.",
      });
    });

    it("changes it: the new password works and the old one no longer does", async () => {
      const result = await asRole("owner").run(() =>
        changeStaffPassword({}, form({ password: "nouveau-pass", confirm: "nouveau-pass" })),
      );
      expect(result.success).toBeTruthy();
      expect(await canLogin("staff", "nouveau-pass", "10.1.0.2")).toBe(true);
      expect(await canLogin("staff", "staff-pass-2026", "10.1.0.3")).toBe(false);
    });
  });

  describe("owner password", () => {
    it("requires the current password, a different new one, and a matching confirmation", async () => {
      const owner = asRole("owner");
      expect(
        await owner.run(() => changeOwnerPassword({}, form({ current: "faux", password: "abcdef", confirm: "abcdef" }))),
      ).toEqual({ error: "Mot de passe actuel incorrect." });
      expect(
        await owner.run(() =>
          changeOwnerPassword({}, form({ current: "owner-pass-2026", password: "owner-pass-2026", confirm: "owner-pass-2026" })),
        ),
      ).toEqual({ error: "Le nouveau mot de passe est identique à l'ancien." });
      expect(
        await owner.run(() => changeOwnerPassword({}, form({ current: "owner-pass-2026", password: "abcdef", confirm: "zzzzzz" }))),
      ).toEqual({ error: "Les deux mots de passe diffèrent." });
      expect(await asRole("staff").run(() => changeOwnerPassword({}, form({ current: "x", password: "abcdef", confirm: "abcdef" })))).toEqual({
        error: "Action réservée au propriétaire.",
      });
    });

    it("changes it", async () => {
      const result = await asRole("owner").run(() =>
        changeOwnerPassword({}, form({ current: "owner-pass-2026", password: "patron-2027", confirm: "patron-2027" })),
      );
      expect(result).toEqual({ success: "Votre mot de passe a été mis à jour." });
      expect(await canLogin("owner", "patron-2027", "10.2.0.1")).toBe(true);
      expect(await canLogin("owner", "owner-pass-2026", "10.2.0.2")).toBe(false);
    });
  });
});

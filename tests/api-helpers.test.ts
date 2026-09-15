import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfigError } from "@/db";
import { NO_STORE, errorResponse, isUuid, jsonNoStore, readJson, unauthorized } from "@/lib/api";
import { NotFoundError, SlotTakenError, ValidationError } from "@/lib/bookings";
import { isTransientWriteError, isUnstorableTextError } from "@/lib/db-errors";

/**
 * What an exception becomes on the wire. The booking sheet branches on the
 * status code — 409 refreshes the grid to show who took the slot, 400 shows
 * the sentence, 503 tells the agent it is not their fault — so every mapping
 * here is a screen the agent actually sees.
 */

/** The shape Drizzle 0.45 really throws: the driver error hangs off `cause`. */
function drizzleError(code: string, extra: Record<string, unknown> = {}) {
  const cause = Object.assign(new Error(`pg error ${code}`), { code, ...extra });
  return Object.assign(new Error("Failed query: insert into ..."), { cause });
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function body(response: Response) {
  return (await response.json()) as { error?: string };
}

describe("errorResponse", () => {
  it("maps the three domain errors to 409, 400 and 404 with their own message", async () => {
    const taken = errorResponse(new SlotTakenError(), "test");
    expect(taken.status).toBe(409);
    expect((await body(taken)).error).toBe("Ce créneau vient d'être réservé sur un autre poste.");

    const invalid = errorResponse(new ValidationError("Numéro invalide."), "test");
    expect(invalid.status).toBe(400);
    expect((await body(invalid)).error).toBe("Numéro invalide.");

    const missing = errorResponse(new NotFoundError("Réservation introuvable."), "test");
    expect(missing.status).toBe(404);
  });

  it("maps deployment problems to 503 without leaking the detail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const config = errorResponse(new ConfigError("DATABASE_URL is not set.", "hint"), "test");
    expect(config.status).toBe(503);
    expect(JSON.stringify(await body(config))).not.toContain("DATABASE_URL");

    const schema = errorResponse(drizzleError("42P01"), "test");
    expect(schema.status).toBe(503);

    const down = errorResponse(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }), "test");
    expect(down.status).toBe(503);

    const auth = errorResponse(drizzleError("28P01"), "test");
    expect(auth.status).toBe(503);
  });

  it("reports anything else as a 500 and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = errorResponse(new Error("boom"), "POST /api/bookings");
    expect(res.status).toBe(500);
    expect((await body(res)).error).toBe("Erreur serveur. Réessayez.");
    expect(log).toHaveBeenCalled();
  });
});

describe("response helpers", () => {
  it("marks JSON responses and 401s as never cacheable", () => {
    expect(jsonNoStore({ ok: true }).headers.get("cache-control")).toBe(NO_STORE["Cache-Control"]);
    const denied = unauthorized();
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toContain("no-store");
  });

  it("recognises app-generated UUIDs and nothing else", () => {
    expect(isUuid("5f1b0c1e-8d2a-4c1b-9e7f-000000000000")).toBe(true);
    expect(isUuid("5F1B0C1E-8D2A-4C1B-9E7F-00000000000A")).toBe(true);
    for (const bad of ["", "1", "5f1b0c1e-8d2a-4c1b-9e7f", "5f1b0c1e8d2a4c1b9e7f000000000000", "' or 1=1 --", "5f1b0c1e-8d2a-4c1b-9e7f-00000000000g"]) {
      expect(isUuid(bad), bad).toBe(false);
    }
    expect(isUuid(undefined as unknown as string)).toBe(false);
  });

  it("parses a JSON body and returns null for anything unparseable", async () => {
    const make = (text: string) => new Request("http://x.test", { method: "POST", body: text });
    expect(await readJson(make('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJson(make("{"))).toBeNull();
    expect(await readJson(make(""))).toBeNull();
    expect(await readJson(new Request("http://x.test", { method: "POST" }))).toBeNull();
  });
});

describe("transient and unstorable write errors", () => {
  it("recognises deadlocks and serialization failures wherever they sit in the cause chain", () => {
    expect(isTransientWriteError(drizzleError("40P01"))).toBe(true);
    expect(isTransientWriteError(drizzleError("40001"))).toBe(true);
    expect(isTransientWriteError({ code: "40P01" })).toBe(true);
    expect(isTransientWriteError(drizzleError("23P01"))).toBe(false);
    expect(isTransientWriteError(drizzleError("23505"))).toBe(false);
    expect(isTransientWriteError(new Error("plain"))).toBe(false);
    expect(isTransientWriteError(null)).toBe(false);
  });

  it("recognises text the database cannot store", () => {
    expect(isUnstorableTextError(drizzleError("22021"))).toBe(true);
    expect(isUnstorableTextError(drizzleError("22P05"))).toBe(true);
    expect(isUnstorableTextError(drizzleError("22P02"))).toBe(false);
    expect(isUnstorableTextError(undefined)).toBe(false);
  });
});

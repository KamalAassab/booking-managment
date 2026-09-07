import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/password";
import {
  OWNER_SESSION_SECONDS,
  SESSION_COOKIE,
  STAFF_SESSION_SECONDS,
  createSessionToken,
  verifySessionToken,
} from "@/lib/session";

const SECRET = "test-session-secret-not-used-in-production";

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

afterEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

function b64url(value: string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("atelier-staff-2026");
    expect(await verifyPassword("atelier-staff-2026", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("atelier-staff-2026");
    expect(await verifyPassword("atelier-staff-2025", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
    expect(await verifyPassword("ATELIER-STAFF-2026", hash)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("stores its parameters so an old hash keeps verifying after a cost change", async () => {
    const hash = await hashPassword("x-password");
    const [scheme, n, r, p] = hash.split("$");
    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
    expect(hash.split("$")).toHaveLength(6);
  });

  it("never stores the password itself", async () => {
    const hash = await hashPassword("recognisable-secret");
    expect(hash).not.toContain("recognisable-secret");
  });

  it("handles unicode and long passwords", async () => {
    const passwords = ["mot-de-passe-é-à-ç", "🔐".repeat(10), "x".repeat(200)];
    for (const password of passwords) {
      const hash = await hashPassword(password);
      expect(await verifyPassword(password, hash)).toBe(true);
      expect(await verifyPassword(`${password}!`, hash)).toBe(false);
    }
  });

  it("rejects a malformed stored hash instead of throwing", async () => {
    for (const stored of [
      "",
      "not-a-hash",
      "scrypt$16384$8$1$onlyfiveparts",
      "bcrypt$16384$8$1$c2FsdA==$aGFzaA==",
      "scrypt$notanumber$8$1$c2FsdA==$aGFzaA==",
      "scrypt$16384$8$1$$aGFzaA==",
      "scrypt$16384$8$1$c2FsdA==$",
    ]) {
      expect(await verifyPassword("anything", stored)).toBe(false);
    }
  });

  it("does not throw when scrypt parameters in the stored hash are absurd", async () => {
    // A corrupted row must fail closed, not crash the login route.
    const stored = "scrypt$99999999$8$1$c2FsdA==$aGFzaA==";
    expect(await verifyPassword("anything", stored)).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips a staff session", () => {
    const { token } = createSessionToken("user-1", "staff");
    const payload = verifySessionToken(token);
    expect(payload?.sub).toBe("user-1");
    expect(payload?.role).toBe("staff");
  });

  it("round-trips an owner session", () => {
    const { token } = createSessionToken("user-2", "owner");
    expect(verifySessionToken(token)?.role).toBe("owner");
  });

  it("gives the front desk a long session and the owner a short one", () => {
    // A front desk must not be logged out mid-day; the owner account holds
    // the password-change power, so it gets a much shorter window.
    expect(createSessionToken("u", "staff").maxAge).toBe(STAFF_SESSION_SECONDS);
    expect(createSessionToken("u", "owner").maxAge).toBe(OWNER_SESSION_SECONDS);
    expect(STAFF_SESSION_SECONDS).toBeGreaterThan(OWNER_SESSION_SECONDS);
  });

  it("rejects a missing or empty token", () => {
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken("")).toBeNull();
  });

  it("rejects a token with no signature", () => {
    expect(verifySessionToken("justabody")).toBeNull();
    expect(verifySessionToken(".sig")).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const { token } = createSessionToken("user-1", "staff");
    const [body] = token.split(".");
    expect(verifySessionToken(`${body}.forged`)).toBeNull();
    expect(verifySessionToken(`${body}.`)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const { token } = createSessionToken("user-1", "staff");
    const [, sig] = token.split(".");
    const forged = b64url(
      JSON.stringify({ sub: "user-1", role: "owner", iat: 1, exp: 9e9 }),
    );
    expect(verifySessionToken(`${forged}.${sig}`)).toBeNull();
  });

  it("refuses a staff cookie edited to say owner — the escalation attempt", () => {
    const { token } = createSessionToken("user-1", "staff");
    const [body, sig] = token.split(".");
    const payload = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
    payload.role = "owner";
    const tampered = b64url(JSON.stringify(payload));
    expect(verifySessionToken(`${tampered}.${sig}`)).toBeNull();
  });

  it("refuses a token signed with a different secret", () => {
    const body = b64url(
      JSON.stringify({ sub: "u", role: "owner", iat: 1, exp: 9e9 }),
    );
    const sig = createHmac("sha256", "some-other-secret-value-here")
      .update(body)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(verifySessionToken(`${body}.${sig}`)).toBeNull();
  });

  it("rotating SESSION_SECRET invalidates every existing session", () => {
    const { token } = createSessionToken("user-1", "staff");
    expect(verifySessionToken(token)).not.toBeNull();
    process.env.SESSION_SECRET = "a-completely-different-secret-value";
    expect(verifySessionToken(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    const past = new Date("2020-01-01T00:00:00Z");
    const { token } = createSessionToken("user-1", "staff", past);
    expect(verifySessionToken(token, new Date("2026-01-01T00:00:00Z"))).toBeNull();
  });

  it("accepts a token that is still inside its window", () => {
    const issued = new Date("2026-01-01T00:00:00Z");
    const { token } = createSessionToken("user-1", "staff", issued);
    const later = new Date(issued.getTime() + 60_000);
    expect(verifySessionToken(token, later)?.sub).toBe("user-1");
  });

  it("rejects a token at the exact instant it expires", () => {
    const issued = new Date("2026-01-01T00:00:00Z");
    const { token, maxAge } = createSessionToken("user-1", "staff", issued);
    const atExpiry = new Date(issued.getTime() + maxAge * 1000);
    expect(verifySessionToken(token, atExpiry)).toBeNull();
  });

  it("rejects a body that is not JSON", () => {
    const body = b64url("not json at all");
    const sig = createHmac("sha256", SECRET)
      .update(body)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(verifySessionToken(`${body}.${sig}`)).toBeNull();
  });

  it("rejects a correctly signed token whose payload is nonsense", () => {
    const sign = (body: string) =>
      createHmac("sha256", SECRET)
        .update(body)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    for (const payload of [
      { sub: "u", role: "admin", iat: 1, exp: 9e9 }, // role not in the enum
      { sub: "", role: "staff", iat: 1, exp: 9e9 }, // empty subject
      { role: "staff", iat: 1, exp: 9e9 }, // no subject
      { sub: 42, role: "staff", iat: 1, exp: 9e9 }, // subject not a string
      { sub: "u", role: "staff", iat: 1 }, // no expiry
      { sub: "u", role: "staff", iat: 1, exp: "later" }, // expiry not a number
      { sub: "u", iat: 1, exp: 9e9 }, // no role
    ]) {
      const body = b64url(JSON.stringify(payload));
      expect(verifySessionToken(`${body}.${sign(body)}`)).toBeNull();
    }
  });

  it("fails closed when SESSION_SECRET is missing", () => {
    const { token } = createSessionToken("user-1", "staff");
    delete process.env.SESSION_SECRET;
    // Verification must refuse rather than accept anything, and it must not
    // throw: an unhandled error here is a 500 on every authenticated page.
    expect(() => verifySessionToken(token)).not.toThrow();
    expect(verifySessionToken(token)).toBeNull();
  });

  it("refuses to issue a token when SESSION_SECRET is too short", () => {
    process.env.SESSION_SECRET = "short";
    expect(() => createSessionToken("u", "staff")).toThrow(/SESSION_SECRET/);
  });

  it("does not crash on adversarial token shapes", () => {
    for (const token of [
      ".",
      "..",
      "a.b.c",
      `${"a".repeat(10_000)}.${"b".repeat(10_000)}`,
      " . ",
      "%%%.%%%",
    ]) {
      expect(() => verifySessionToken(token)).not.toThrow();
      expect(verifySessionToken(token)).toBeNull();
    }
  });

  it("names the cookie consistently", () => {
    expect(SESSION_COOKIE).toBe("atelier_session");
  });
});

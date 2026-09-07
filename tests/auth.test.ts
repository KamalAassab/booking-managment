import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/password";
import {
  OWNER_SESSION_SECONDS,
  STAFF_SESSION_SECONDS,
  createSessionToken,
  verifySessionToken,
} from "@/lib/session";

/**
 * Access control is the other place a bug costs the business real money:
 * the shared staff account must never reach the owner screen, and a cookie
 * must not be forgeable by anyone who can read one.
 */

const SECRET = "test-secret-value-at-least-16-chars";

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.SESSION_SECRET;
});

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("atelier-2026!");
    expect(await verifyPassword("atelier-2026!", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("atelier-2026!");
    expect(await verifyPassword("atelier-2026", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("never stores the password in the hash string", async () => {
    const hash = await hashPassword("plaintext-leak-check");
    expect(hash).not.toContain("plaintext-leak-check");
  });

  it("returns false rather than throwing on a malformed stored hash", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1$$")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$16384$8$1$c2FsdA==$aGFzaA==")).toBe(
      false,
    );
  });
});

describe("session tokens", () => {
  it("round-trips a staff session", () => {
    const { token } = createSessionToken("user-1", "staff");
    const payload = verifySessionToken(token);
    expect(payload?.sub).toBe("user-1");
    expect(payload?.role).toBe("staff");
  });

  it("gives the owner a much shorter session than shared staff devices", () => {
    expect(createSessionToken("u", "owner").maxAge).toBe(OWNER_SESSION_SECONDS);
    expect(createSessionToken("u", "staff").maxAge).toBe(STAFF_SESSION_SECONDS);
    expect(OWNER_SESSION_SECONDS).toBeLessThan(STAFF_SESSION_SECONDS);
  });

  it("rejects a token whose payload was edited to escalate role", () => {
    const { token } = createSessionToken("user-1", "staff");
    const [body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    payload.role = "owner";
    const forgedBody = Buffer.from(JSON.stringify(payload)).toString(
      "base64url",
    );
    expect(verifySessionToken(`${forgedBody}.${sig}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = createSessionToken("user-1", "owner");
    process.env.SESSION_SECRET = "a-completely-different-secret-key";
    expect(verifySessionToken(token)).toBeNull();
  });

  it("rejects malformed and empty tokens", () => {
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken("")).toBeNull();
    expect(verifySessionToken("no-dot")).toBeNull();
    expect(verifySessionToken(".onlysig")).toBeNull();
    expect(verifySessionToken("garbage.garbage")).toBeNull();
  });

  it("rejects an expired token", () => {
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    const { token } = createSessionToken("user-1", "owner", issuedAt);
    const afterExpiry = new Date(
      issuedAt.getTime() + (OWNER_SESSION_SECONDS + 1) * 1000,
    );
    expect(verifySessionToken(token, afterExpiry)).toBeNull();
    // Still valid a minute before it lapses.
    const beforeExpiry = new Date(
      issuedAt.getTime() + (OWNER_SESSION_SECONDS - 60) * 1000,
    );
    expect(verifySessionToken(token, beforeExpiry)?.role).toBe("owner");
  });

  it("rejects a token carrying an unknown role", () => {
    const body = Buffer.from(
      JSON.stringify({
        sub: "u",
        role: "admin",
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 600,
      }),
    ).toString("base64url");
    // Sign it properly — only the role is wrong.
    const sig = createHmac("sha256", SECRET)
      .update(body)
      .digest("base64url");
    expect(verifySessionToken(`${body}.${sig}`)).toBeNull();
  });

  it("refuses to verify when SESSION_SECRET is missing", () => {
    const { token } = createSessionToken("user-1", "staff");
    delete process.env.SESSION_SECRET;
    expect(verifySessionToken(token)).toBeNull();
  });

  it("refuses to issue a token with a too-short SESSION_SECRET", () => {
    process.env.SESSION_SECRET = "short";
    expect(() => createSessionToken("user-1", "staff")).toThrow();
  });
});

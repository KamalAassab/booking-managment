import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_ATTEMPTS,
  checkRateLimit,
  clientKeyFromHeaders,
  recordFailure,
  recordSuccess,
  resetRateLimits,
} from "@/lib/rate-limit";

beforeEach(() => {
  resetRateLimits();
});

describe("login throttling", () => {
  it("allows a fresh key", () => {
    const result = checkRateLimit("ip-1");
    expect(result.allowed).toBe(true);
  });

  it("allows the first few wrong guesses — staff mistype passwords", () => {
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      recordFailure("ip-1");
      expect(checkRateLimit("ip-1").allowed).toBe(true);
    }
  });

  it("locks out once the limit is reached", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordFailure("ip-1");
    const result = checkRateLimit("ip-1");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("backs off further with each failure past the limit", () => {
    const now = Date.now();
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordFailure("ip-1", now);
    const first = checkRateLimit("ip-1", now);
    recordFailure("ip-1", now);
    const second = checkRateLimit("ip-1", now);

    expect(first.allowed).toBe(false);
    expect(second.allowed).toBe(false);
    if (!first.allowed && !second.allowed) {
      expect(second.retryAfterSeconds).toBeGreaterThan(first.retryAfterSeconds);
    }
  });

  it("caps the backoff so a mistake does not lock the salon out all day", () => {
    const now = Date.now();
    for (let i = 0; i < 50; i += 1) recordFailure("ip-1", now);
    const result = checkRateLimit("ip-1", now);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    }
  });

  it("lets the key through again once the block has elapsed", () => {
    const now = Date.now();
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordFailure("ip-1", now);
    expect(checkRateLimit("ip-1", now).allowed).toBe(false);
    expect(checkRateLimit("ip-1", now + 16 * 60_000).allowed).toBe(true);
  });

  it("clears the record on a correct password", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordFailure("ip-1");
    expect(checkRateLimit("ip-1").allowed).toBe(false);
    recordSuccess("ip-1");
    expect(checkRateLimit("ip-1").allowed).toBe(true);
  });

  it("keeps keys independent, so one bad actor cannot lock out a salon", () => {
    for (let i = 0; i < MAX_ATTEMPTS + 5; i += 1) recordFailure("attacker");
    expect(checkRateLimit("attacker").allowed).toBe(false);
    expect(checkRateLimit("front-desk-vip").allowed).toBe(true);
  });

  it("separates the staff and owner buckets for the same address", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordFailure("login:staff:ip-1");
    expect(checkRateLimit("login:staff:ip-1").allowed).toBe(false);
    expect(checkRateLimit("login:owner:ip-1").allowed).toBe(true);
  });

  it("checking does not itself consume an attempt", () => {
    for (let i = 0; i < 100; i += 1) checkRateLimit("ip-1");
    expect(checkRateLimit("ip-1").allowed).toBe(true);
  });

  it("keeps working after a spray of forged addresses fills the table", () => {
    const now = Date.now();
    // One guess each from twelve thousand distinct addresses — the shape of
    // a distributed attempt, and the shape that would grow an unbounded map.
    for (let i = 0; i < 12_000; i += 1) recordFailure(`ip-${i}`, now);

    // Bounded memory must not come at the cost of the limiter still working:
    // a key that genuinely exceeds the limit is still blocked afterwards.
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordFailure("real-attacker", now);
    expect(checkRateLimit("real-attacker", now).allowed).toBe(false);
  });

  it("forgets a key that has been quiet for an hour", () => {
    const now = Date.now();
    recordFailure("ip-1", now);
    // A later failure from a different key triggers the sweep.
    recordFailure("ip-2", now + 2 * 60 * 60_000);
    expect(checkRateLimit("ip-1", now + 2 * 60 * 60_000).allowed).toBe(true);
  });
});

describe("clientKeyFromHeaders", () => {
  it("takes the left-most entry of x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178",
    });
    expect(clientKeyFromHeaders(headers)).toBe("203.0.113.7");
  });

  it("trims whitespace", () => {
    expect(
      clientKeyFromHeaders(new Headers({ "x-forwarded-for": "  203.0.113.7  " })),
    ).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(
      clientKeyFromHeaders(new Headers({ "x-real-ip": "203.0.113.9" })),
    ).toBe("203.0.113.9");
  });

  it("falls back to a shared bucket when no header is present", () => {
    // Everyone shares one bucket rather than the limiter switching off.
    expect(clientKeyFromHeaders(new Headers())).toBe("unknown");
  });

  it("does not throw on an empty header value", () => {
    expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": "" }))).toBe(
      "unknown",
    );
  });
});

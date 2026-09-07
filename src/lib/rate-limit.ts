/**
 * Login throttling.
 *
 * There is exactly one shared staff password and one owner password, both on
 * a publicly reachable URL. Without a limit, an attacker gets unlimited
 * guesses at two secrets that protect every client's name and phone number,
 * and each guess costs the salon a scrypt hash on Vercel's clock.
 *
 * This is an in-memory limiter, which on serverless means per warm instance
 * rather than global. That is a real limitation and worth being honest about:
 * it does not make brute force impossible, it makes it expensive and slow
 * enough to be impractical, and it costs nothing to run. A shared store
 * (Redis/Upstash) would be the strict answer, but it adds a paid dependency
 * and a new failure mode to a system whose whole design goal is running
 * unattended for years — see PROJECT_BRIEF.md §6.
 */

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

type Bucket = {
  failures: number;
  /** Epoch ms; while in the future, every attempt is refused. */
  blockedUntil: number;
  /** Epoch ms of the last failure, used to expire idle buckets. */
  lastFailureAt: number;
};

/** Failures allowed before the first lockout. */
export const MAX_ATTEMPTS = 5;
/** Lockout doubles per failure past the limit, up to this ceiling. */
const BASE_BLOCK_MS = 30_000;
const MAX_BLOCK_MS = 15 * 60_000;
/** A quiet key is forgotten entirely after this long. */
const BUCKET_TTL_MS = 60 * 60_000;
/** Hard cap so a spray of forged IPs cannot grow the map without bound. */
const MAX_BUCKETS = 10_000;

const buckets = new Map<string, Bucket>();

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (
      now - bucket.lastFailureAt > BUCKET_TTL_MS &&
      bucket.blockedUntil <= now
    ) {
      buckets.delete(key);
    }
  }
  if (buckets.size <= MAX_BUCKETS) return;
  // Still too many: drop the oldest entries. Map preserves insertion order,
  // so the head is the least recently created.
  const excess = buckets.size - MAX_BUCKETS;
  let dropped = 0;
  for (const key of buckets.keys()) {
    if (dropped >= excess) break;
    buckets.delete(key);
    dropped += 1;
  }
}

/** Does this key currently have an attempt available? Does not record one. */
export function checkRateLimit(key: string, now = Date.now()): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket) return { allowed: true, remaining: MAX_ATTEMPTS };

  if (bucket.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((bucket.blockedUntil - now) / 1000),
    };
  }
  return {
    allowed: true,
    remaining: Math.max(0, MAX_ATTEMPTS - bucket.failures),
  };
}

/** Records a failed attempt and returns the state the *next* one will see. */
export function recordFailure(key: string, now = Date.now()): RateLimitResult {
  sweep(now);

  const bucket = buckets.get(key) ?? {
    failures: 0,
    blockedUntil: 0,
    lastFailureAt: now,
  };
  bucket.failures += 1;
  bucket.lastFailureAt = now;

  if (bucket.failures >= MAX_ATTEMPTS) {
    const over = bucket.failures - MAX_ATTEMPTS;
    const block = Math.min(BASE_BLOCK_MS * 2 ** over, MAX_BLOCK_MS);
    bucket.blockedUntil = now + block;
  }

  buckets.set(key, bucket);
  return checkRateLimit(key, now);
}

/** A correct password clears the record for that key. */
export function recordSuccess(key: string): void {
  buckets.delete(key);
}

/** Test-only: forget every bucket. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * The client's address, from the proxy headers Vercel sets. Spoofable in
 * principle — which is why a wrong answer here degrades to "this attacker
 * gets their own bucket" rather than to "the limiter is off".
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    // Left-most entry is the original client; the rest are proxies.
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

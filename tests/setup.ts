import { config } from "dotenv";

/**
 * Test environment.
 *
 * `.env.test.local` supplies TEST_DATABASE_URL when a Postgres is available.
 * Integration suites skip themselves when it is absent, so `npm test` still
 * passes on a machine with no database — the pure-logic suites, which are the
 * majority, do not need one.
 */
config({ path: ".env.test.local", quiet: true });
config({ path: ".env.local", quiet: true });

// A fixed, obviously-fake secret. Tests that care about signing behaviour set
// their own; this only ensures the default is long enough to be valid.
process.env.SESSION_SECRET ??= "test-session-secret-not-used-in-production";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

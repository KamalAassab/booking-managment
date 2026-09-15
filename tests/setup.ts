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

// TEST_NEON_HTTP=1: the same database suites, through the Neon HTTP driver
// production uses. A `.neon.tech` host makes src/db pick that driver, and the
// driver is pointed at a local emulator of Neon's HTTP endpoint that forwards
// to TEST_DATABASE_URL — see tests/helpers/neon-http-emulator.ts.
if (process.env.TEST_DATABASE_URL && process.env.TEST_NEON_HTTP === "1") {
  const { neonConfig } = await import("@neondatabase/serverless");
  const { startNeonHttpEmulator } = await import("./helpers/neon-http-emulator");
  const emulator = await startNeonHttpEmulator(process.env.TEST_DATABASE_URL);
  neonConfig.fetchEndpoint = () => emulator.endpoint;
  const local = new URL(process.env.TEST_DATABASE_URL);
  const emulated = `postgresql://${local.username}:${local.password}@emulated-endpoint.neon.tech${local.pathname}`;
  process.env.DATABASE_URL = emulated;
  process.env.NEON_HTTP_EMULATED_URL = emulated;
}

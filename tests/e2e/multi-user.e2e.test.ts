import { afterAll, describe } from "vitest";

import { hasTestDatabase } from "../helpers/db";
import { closeDb } from "../helpers/fixtures";
import { httpTransport } from "../helpers/transport-http";
import { defineMultiUserScenarios } from "../scenarios/multi-user";

/**
 * The same five-user scenarios over real HTTP, against a production build
 * served by `next start` in its own process.
 *
 * Opt-in, because it needs a running server pointed at the same database as
 * TEST_DATABASE_URL, and signing the same SESSION_SECRET:
 *
 *   E2E_BASE_URL=http://127.0.0.1:3100 \
 *   TEST_DATABASE_URL=postgres://.../atelier_e2e \
 *   SESSION_SECRET=<the server's secret> \
 *   npx vitest run tests/e2e
 */

const baseUrl = process.env.E2E_BASE_URL;
const describeE2E = baseUrl && hasTestDatabase ? describe : describe.skip;

afterAll(closeDb);

describeE2E("multi-user (HTTP, production build)", () => {
  defineMultiUserScenarios("http", httpTransport(baseUrl ?? "http://127.0.0.1:0"));
});

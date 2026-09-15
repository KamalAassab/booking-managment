import { afterAll, vi } from "vitest";

import { describeIfDb } from "../helpers/db";
import { closeDb } from "../helpers/fixtures";
import { inProcessTransport } from "../helpers/transport-inprocess";
import { defineMultiUserScenarios } from "../scenarios/multi-user";

vi.mock("next/headers", () => import("../helpers/next-headers"));

/**
 * The five-user scenarios against the real route handlers, in this process,
 * with a real PostgreSQL behind them. See tests/scenarios/multi-user.ts.
 */

afterAll(closeDb);

describeIfDb("multi-user (route handlers)", () => {
  defineMultiUserScenarios("route handlers", inProcessTransport);
});

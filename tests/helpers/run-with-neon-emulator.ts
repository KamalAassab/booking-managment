/**
 * Runs one of the project's scripts (migrate, seed) through the Neon HTTP
 * driver against a local database, via the emulator in neon-http-emulator.ts.
 *
 *   npx tsx tests/helpers/run-with-neon-emulator.ts <local-postgres-url> scripts/migrate.ts
 *
 * The scripts pick the Neon driver from a `.neon.tech` host, exactly as they
 * do against production; only the HTTP endpoint is local.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { neonConfig } from "@neondatabase/serverless";

import { startNeonHttpEmulator } from "./neon-http-emulator";

const [localUrl, script] = process.argv.slice(2);
if (!localUrl || !script) {
  console.error("usage: run-with-neon-emulator.ts <local-postgres-url> <script>");
  process.exit(2);
}

async function main(localConnection: string, scriptPath: string) {
  const emulator = await startNeonHttpEmulator(localConnection);
  neonConfig.fetchEndpoint = () => emulator.endpoint;
  const local = new URL(localConnection);
  process.env.DATABASE_URL = `postgresql://${local.username}:${local.password}@emulated-endpoint.neon.tech${local.pathname}`;
  await import(pathToFileURL(path.resolve(scriptPath)).href);
}

void main(localUrl, script);

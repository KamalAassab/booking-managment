import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import pg from "pg";

/**
 * A local stand-in for Neon's SQL-over-HTTP endpoint, in front of a plain
 * PostgreSQL.
 *
 * Production reaches its database through @neondatabase/serverless's HTTP
 * driver, not node-postgres: every query is a POST, results come back as raw
 * text for the client to parse, and errors arrive as a JSON body that the
 * driver turns into a NeonDbError. With TEST_NEON_HTTP=1 the whole database
 * suite runs through that real driver and Drizzle's neon-http session,
 * pointed here by `neonConfig.fetchEndpoint` — so result parsing, error
 * shapes and the migration runner are exercised exactly as deployed, with
 * only the network hop replaced.
 *
 * It implements what the driver sends (see `neon()` in the package source):
 * a single `{ query, params }`, or `{ queries: [...] }` run in one
 * transaction, with the `Neon-Raw-Text-Output` and `Neon-Array-Mode` headers.
 */

/** PostgreSQL error fields the driver copies from a 400 onto NeonDbError. */
const ERROR_FIELDS = [
  "severity", "code", "detail", "hint", "position", "internalPosition", "internalQuery",
  "where", "schema", "table", "column", "dataType", "constraint", "file", "line", "routine",
] as const;

type QueryData = { query: string; params?: unknown[] };

/** Every value as the text PostgreSQL sent it — the driver parses by type OID. */
const RAW_TEXT = { getTypeParser: () => (value: string) => value };

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function run(client: pg.PoolClient, data: QueryData) {
  const result = await client.query({
    text: data.query,
    values: data.params ?? [],
    rowMode: "array",
    types: RAW_TEXT,
  });
  return {
    fields: result.fields.map((f) => ({
      name: f.name,
      dataTypeID: f.dataTypeID,
      tableID: f.tableID,
      columnID: f.columnID,
      dataTypeSize: f.dataTypeSize,
      dataTypeModifier: f.dataTypeModifier,
      format: "text",
    })),
    rows: result.rows,
    command: result.command,
    rowCount: result.rowCount,
    rowAsArray: true,
  };
}

function errorBody(error: unknown) {
  const source = error as Record<string, unknown>;
  const body: Record<string, unknown> = {
    message: typeof source?.message === "string" ? source.message : String(error),
  };
  for (const field of ERROR_FIELDS) {
    if (source?.[field] !== undefined) body[field] = source[field];
  }
  return body;
}

export type NeonHttpEmulator = {
  endpoint: string;
  close: () => Promise<void>;
};

export async function startNeonHttpEmulator(
  connectionString: string,
): Promise<NeonHttpEmulator> {
  const pool = new pg.Pool({ connectionString, max: 20, allowExitOnIdle: true });

  const server: Server = createServer(async (request, response) => {
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };

    if (request.method !== "POST") return reply(405, { message: "POST only" });
    if (request.headers["neon-raw-text-output"] !== "true" || request.headers["neon-array-mode"] !== "true") {
      return reply(400, { message: "emulator expects raw text, array mode" });
    }

    let payload: QueryData | { queries: QueryData[] };
    try {
      payload = JSON.parse(await readBody(request));
    } catch {
      return reply(400, { message: "invalid JSON body" });
    }

    const client = await pool.connect();
    try {
      if ("queries" in payload) {
        const isolation = request.headers["neon-batch-isolation-level"];
        await client.query(
          `begin${typeof isolation === "string" ? ` isolation level ${isolation.replace(/([a-z])([A-Z])/g, "$1 $2")}` : ""}`,
        );
        try {
          const results = [];
          for (const query of payload.queries) results.push(await run(client, query));
          await client.query("commit");
          return reply(200, { results });
        } catch (error) {
          await client.query("rollback").catch(() => undefined);
          return reply(400, errorBody(error));
        }
      }
      return reply(200, await run(client, payload));
    } catch (error) {
      return reply(400, errorBody(error));
    } finally {
      client.release();
    }
  });
  server.unref();

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${port}/sql`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
    },
  };
}

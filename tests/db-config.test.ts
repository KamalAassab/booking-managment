import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConfigError,
  driverFor,
  inspectConnection,
  maskHost,
  sanitiseConnectionString,
} from "@/db";

/**
 * Reading DATABASE_URL out of a dashboard rather than a .env file.
 *
 * dotenv strips the quotes around a value; Vercel's environment-variable UI
 * stores exactly what was pasted. The line copied straight out of
 * .env.example therefore arrives still wrapped in apostrophes, `new URL()`
 * refuses it, and every page answers with a server error while the variable
 * looks, in the dashboard, perfectly correct. That is what "the environment
 * variables are set right but the database will not connect" turns out to be.
 */

const NEON =
  "postgresql://neondb_owner:secret@ep-misty-hall-b25oayrg-pooler.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

describe("sanitiseConnectionString", () => {
  it("leaves a correct value completely alone", () => {
    const { value, notes } = sanitiseConnectionString(NEON);
    expect(value).toBe(NEON);
    expect(notes).toEqual([]);
  });

  it.each([
    ["single quotes", `'${NEON}'`],
    ["double quotes", `"${NEON}"`],
    ["backticks", `\`${NEON}\``],
    ["surrounding whitespace and a trailing newline", `  ${NEON}\n`],
    ["the variable's own name", `DATABASE_URL=${NEON}`],
    ["the name and quotes together", `DATABASE_URL='${NEON}'`],
    ["a copied psql command", `psql '${NEON}'`],
  ])("recovers the connection string from %s", (_label, raw) => {
    expect(sanitiseConnectionString(raw).value).toBe(NEON);
  });

  it("reports every rule it had to apply, so the value gets fixed at source", () => {
    expect(sanitiseConnectionString(NEON).notes).toHaveLength(0);
    expect(sanitiseConnectionString(`'${NEON}'`).notes).toHaveLength(1);
    expect(sanitiseConnectionString(`DATABASE_URL='${NEON}'`).notes).toHaveLength(2);
  });

  it("does not strip quotes that are not a matching pair", () => {
    // A password may legitimately end in a quote; only a value wrapped in the
    // same character at both ends is a paste artefact.
    expect(sanitiseConnectionString(`'${NEON}`).value).toBe(`'${NEON}`);
    expect(sanitiseConnectionString(`"${NEON}'`).value).toBe(`"${NEON}'`);
  });
});

describe("maskHost", () => {
  it("hides the segment that identifies the project", () => {
    const masked = maskHost(
      "ep-misty-hall-b25oayrg-pooler.c-6.eu-central-1.aws.neon.tech",
    );
    expect(masked).toBe("ep-misty-…-pooler.c-6.eu-central-1.aws.neon.tech");
    expect(masked).not.toContain("b25oayrg");
  });

  it("hides it on a direct host too, where it is the last segment", () => {
    const masked = maskHost("ep-misty-hall-b25oayrg.c-6.eu-central-1.aws.neon.tech");
    expect(masked).toBe("ep-misty-….c-6.eu-central-1.aws.neon.tech");
    expect(masked).not.toContain("b25oayrg");
  });

  it("leaves a host with nothing to hide as it is", () => {
    expect(maskHost("localhost")).toBe("localhost");
    expect(maskHost("db.internal")).toBe("db.internal");
    expect(maskHost("127.0.0.1")).toBe("127.0.0.1");
  });
});

describe("driverFor", () => {
  it("picks the HTTP driver for Neon and node-postgres for anything else", () => {
    expect(driverFor(NEON)).toBe("neon-http");
    expect(driverFor("postgresql://localhost:5432/atelier")).toBe("node-postgres");
  });

  it.each([
    ["a value that is not a URL at all", "not-a-connection-string"],
    ["a value still wrapped in quotes", `'${NEON}'`],
    ["the wrong scheme", "https://ep-x.eu-central-1.aws.neon.tech/neondb"],
  ])("refuses %s with an explanation, not a crash", (_label, raw) => {
    expect(() => driverFor(raw)).toThrow(ConfigError);
    try {
      driverFor(raw);
    } catch (error) {
      expect((error as ConfigError).hint).not.toHaveLength(0);
    }
  });
});

describe("inspectConnection", () => {
  const original = process.env.DATABASE_URL;
  beforeEach(() => {
    process.env.DATABASE_URL = NEON;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it("describes the target without publishing anything usable", () => {
    const info = inspectConnection();
    expect(info.driver).toBe("neon-http");
    expect(info.pooled).toBe(true);
    expect(info.notes).toEqual([]);
    // /api/health is reachable without a session, so this must never carry
    // the credentials or the full endpoint id.
    expect(info.host).not.toContain("secret");
    expect(info.host).not.toContain("neondb_owner");
    expect(info.host).not.toContain("b25oayrg");
  });

  it("flags a quoted value as working-but-wrong rather than failing", () => {
    process.env.DATABASE_URL = `'${NEON}'`;
    const info = inspectConnection();
    expect(info.driver).toBe("neon-http");
    expect(info.notes).toHaveLength(1);
    expect(info.notes[0]).toContain("quotes");
  });

  it("notices a direct host, which the HTTP driver should not be pointed at", () => {
    process.env.DATABASE_URL = NEON.replace("-pooler", "");
    expect(inspectConnection().pooled).toBe(false);
  });

  it("raises a ConfigError naming the problem when the value is unusable", () => {
    process.env.DATABASE_URL = "  ";
    expect(() => inspectConnection()).toThrow(ConfigError);
    process.env.DATABASE_URL = "''";
    expect(() => inspectConnection()).toThrow(/nothing but quotes/i);
  });
});

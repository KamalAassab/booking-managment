import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws on import outside a React Server Component, which
      // would make src/lib/bookings.ts — the file most worth testing — untestable.
      // The package exists to fail a *bundle* that pulls server code into the
      // browser; under vitest there is no bundle and no browser, so a stub is
      // the correct substitution rather than a way around a real check.
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Integration tests share one Postgres database. Running files in
    // parallel would let one file's truncation delete another's fixtures
    // mid-assertion, so they are serialised; they are fast enough that this
    // costs a couple of seconds.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

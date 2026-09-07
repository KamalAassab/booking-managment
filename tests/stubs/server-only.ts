/**
 * Stand-in for the `server-only` package under vitest.
 *
 * The real package's entire body is a `throw`, which is how it fails a build
 * that pulls server code into a client bundle. There is no bundle here, so
 * importing it would only make the server modules untestable.
 */
export {};

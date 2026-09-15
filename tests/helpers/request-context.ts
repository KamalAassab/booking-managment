import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Stand-in for the per-request state Next.js provides to route handlers.
 *
 * `getSession()` reads the cookie through `cookies()` from next/headers, which
 * only exists inside a real Next.js request. The integration suites mock that
 * module with next-headers.ts, and this AsyncLocalStorage gives every
 * simulated request its own cookie jar — so five "users" firing at the same
 * instant each present their own session instead of whichever was set last.
 */
export type RequestContext = {
  cookies: Map<string, string>;
  headers: Headers;
};

export const requestContext = new AsyncLocalStorage<RequestContext>();

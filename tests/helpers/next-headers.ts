import { requestContext } from "./request-context";

/**
 * The subset of next/headers the application uses, backed by the current
 * simulated request. Wired in per test file with:
 *
 *   vi.mock("next/headers", () => import("./helpers/next-headers"));
 */
export async function cookies() {
  const jar = requestContext.getStore()?.cookies ?? new Map<string, string>();
  return {
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) as string } : undefined,
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  };
}

export async function headers() {
  return requestContext.getStore()?.headers ?? new Headers();
}

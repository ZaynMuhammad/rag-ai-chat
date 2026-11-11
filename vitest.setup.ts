import { addEqualityTesters } from "@effect/vitest";

addEqualityTesters();

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

const requestUrl = (input: Parameters<typeof fetch>[0]) =>
  new URL(input instanceof Request ? input.url : input);

const unguardedFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = requestUrl(input);
  if (!loopbackHosts.has(url.hostname)) {
    return Promise.reject(
      new Error(
        `Tests must not reach the network (${url.host}). Use the mock provider.`,
      ),
    );
  }
  return unguardedFetch(input, init);
};

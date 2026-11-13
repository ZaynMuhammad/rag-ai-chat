import { describe, expect, it, vi } from "@effect/vitest";
import { Effect } from "effect";
import { fetchWithSession } from "./session";

describe("fetchWithSession", () => {
  it.effect(
    "hands back a rate limit on session issuance so callers can say so",
    () =>
      Effect.promise(async () => {
        const requested: Array<string> = [];
        vi.stubGlobal("localStorage", {
          getItem: () => null,
          setItem: () => undefined,
        });
        vi.stubGlobal("fetch", (url: string) => {
          requested.push(url);
          return Promise.resolve(new Response(null, { status: 429 }));
        });
        const response = await fetchWithSession("/api/chat", {
          method: "POST",
        });
        expect(response.status).toBe(429);
        expect(requested).toEqual(["/api/session"]);
      }),
  );
});

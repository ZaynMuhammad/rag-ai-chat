import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { RateLimiter } from "effect/persistence";
import { corpusFixture, sovietUnion } from "@/server/corpus/CorpusFixture";
import { SearchResults } from "@/server/search/SearchResults";
import { AnonymousSessions, defaultPolicy } from "./AnonymousSessions";
import { serveSearch } from "./SearchGateway";

const fixture = corpusFixture([
  {
    qid: "Q1",
    title: "Tetris",
    released: "1985",
    origins: [sovietUnion],
    passages: [
      {
        heading: "Tetris",
        text: "Tetris is a puzzle video game created by Alexey Pajitnov.",
      },
    ],
  },
]);

const gateway = Layer.mergeAll(
  SearchResults.layer.pipe(Layer.provide(fixture)),
  Layer.effect(
    AnonymousSessions,
    AnonymousSessions.make({
      ...defaultPolicy,
      search: { limit: 2, window: "1 minute" },
    }),
  ).pipe(
    Layer.provide(RateLimiter.layer),
    Layer.provide(RateLimiter.layerStoreMemory),
  ),
);

describe("serveSearch", () => {
  it.effect(
    "answers 429 with retry-after once searches pass the global limit",
    () =>
      Effect.gen(function* () {
        assert.strictEqual((yield* serveSearch("Tetris")).status, 200);
        assert.strictEqual((yield* serveSearch("Pajitnov")).status, 200);
        const limited = yield* serveSearch("Tetris");
        assert.strictEqual(limited.status, 429);
        assert.isAtLeast(Number(limited.headers.get("retry-after")), 1);
      }).pipe(Effect.provide(gateway)),
  );

  it.effect("rejects a bad query without spending the limit", () =>
    Effect.gen(function* () {
      assert.strictEqual((yield* serveSearch(null)).status, 400);
      assert.strictEqual((yield* serveSearch("   ")).status, 400);
      assert.strictEqual((yield* serveSearch("Tetris")).status, 200);
      assert.strictEqual((yield* serveSearch("Tetris")).status, 200);
    }).pipe(Effect.provide(gateway)),
  );
});

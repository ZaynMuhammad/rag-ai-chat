import { assert, describe, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  corpusFixture,
  embedFixturePassages,
  japan,
  sovietUnion,
  unitedStates,
} from "@/server/corpus/CorpusFixture";
import type { Scope } from "@/server/games/Scope";
import { DenseIndex } from "./DenseIndex";
import { Embedder } from "./Embedder";

const fixture = corpusFixture([
  {
    qid: "Q1",
    title: "Tetris",
    released: "1985",
    origins: [sovietUnion],
    passages: [
      {
        heading: "Tetris",
        text: "Tetris is a falling block puzzle created by Alexey Pajitnov.",
      },
      { heading: "Tetris > Legacy", text: "It inspired many puzzle games." },
    ],
  },
  {
    qid: "Q2",
    title: "Puyo Puyo",
    released: "1991-10-25",
    origins: [japan],
    passages: [
      {
        heading: "Puyo Puyo",
        text: "Puyo Puyo is a falling block puzzle developed by Compile.",
      },
    ],
  },
  {
    qid: "Q3",
    title: "Doom",
    released: "1993-12-10",
    origins: [unitedStates],
    passages: [
      {
        heading: "Doom",
        text: "Doom is a falling block puzzle in name only; it is a shooter.",
      },
    ],
  },
]);

const denseIndex = (skip: ReadonlyArray<string>) =>
  DenseIndex.layer.pipe(
    Layer.provideMerge(embedFixturePassages(skip)),
    Layer.provideMerge(Embedder.hashed(64)),
    Layer.provideMerge(fixture),
  );

const search = (query: string, scope: Scope = {}) =>
  Effect.flatMap(DenseIndex, (index) =>
    index.search({ query, scope, limit: 5 }),
  ).pipe(Effect.map((passages) => passages.map((passage) => passage.id)));

layer(denseIndex([]))("DenseIndex", (it) => {
  it.effect("ranks the closest passage first and returns full passages", () =>
    Effect.gen(function* () {
      const index = yield* DenseIndex;
      const [first] = yield* index.search({
        query: "Alexey Pajitnov",
        scope: {},
        limit: 1,
      });
      assert.strictEqual(first?.id, "Q1#0");
      assert.strictEqual(first?.title, "Tetris");
      assert.strictEqual(index.size.passages, 4);
      assert.strictEqual(index.size.bytes, 4 * 64 + 4 * 4 + 4 * 8);
    }),
  );

  it.effect("only returns passages from games inside the scope", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* search("falling block puzzle", { region: "Asia" }),
        ["Q2#0"],
      );
      assert.deepStrictEqual(
        (yield* search("falling block puzzle", {
          from: 1990,
          to: 1993,
        })).sort(),
        ["Q2#0", "Q3#0"],
      );
      assert.deepStrictEqual(
        (yield* search("falling block puzzle", { gameQid: "Q1" })).sort(),
        ["Q1#0", "Q1#1"],
      );
      assert.deepStrictEqual(
        yield* search("falling block puzzle", { region: "Oceania" }),
        [],
      );
    }),
  );
});

layer(denseIndex(["Q2#0"]))("DenseIndex during a partial embed", (it) => {
  it.effect("leaves out passages that have no embedding yet", () =>
    Effect.gen(function* () {
      assert.strictEqual((yield* DenseIndex).size.passages, 3);
      assert.notInclude(yield* search("Puyo Puyo Compile"), "Q2#0");
      assert.deepStrictEqual(yield* search("Puyo", { region: "Asia" }), []);
    }),
  );
});

describe("DenseIndex with no embeddings", () => {
  layer(denseIndex(["Q1#0", "Q1#1", "Q2#0", "Q3#0"]))((it) => {
    it.effect("returns nothing instead of failing", () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* search("falling block puzzle"), []);
      }),
    );
  });
});

import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Article } from "./Article";
import { Retriever } from "./Retriever";

const article = (id: string, title: string, summary: string): Article => ({
  id,
  title,
  summary,
  url: `https://example.test/${id}`,
});

const articles = [
  article("moon", "Moon", "The Moon orbits Earth and causes tides."),
  article("tides", "Tide", "Tides rise and fall because of the Moon."),
  article("bee", "Honey bee", "Bees make honey from nectar."),
  article("volcano", "Volcano", "Lava comes out of a volcano."),
  article("ocean", "Ocean", "The ocean has tides and waves near the Moon."),
];

const retrieve = (query: string, ids: ReadonlyArray<string>) =>
  Retriever.make(articles).retrieve(query, ids);

describe("Retriever", () => {
  it.effect("only returns passages from selected articles", () =>
    Effect.gen(function* () {
      const passages = yield* retrieve("moon tides", ["bee", "tides"]);
      assert.deepStrictEqual(passages.map((passage) => passage.articleId), ["tides"]);
    }),
  );

  it.effect("ranks title matches above summary-only matches", () =>
    Effect.gen(function* () {
      const passages = yield* retrieve("What is the moon?", ["ocean", "tides", "moon"]);
      assert.strictEqual(passages[0]?.articleId, "moon");
    }),
  );

  it.effect("returns at most topK passages", () =>
    Effect.gen(function* () {
      const passages = yield* retrieve(
        "moon tides",
        articles.map((entry) => entry.id),
      );
      assert.strictEqual(passages.length, Retriever.topK);
    }),
  );

  it.effect("returns nothing when no selected article matches", () =>
    Effect.gen(function* () {
      const passages = yield* retrieve("volcano lava", ["moon", "bee"]);
      assert.deepStrictEqual(passages, []);
    }),
  );
});

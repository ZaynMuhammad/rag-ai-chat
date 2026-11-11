import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { assert, describe, expect, it, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { CorpusStore, latestRevisionPerGame, migrations } from "./CorpusStore";
import type { StructuredArticle } from "./StructuredWikipedia";

const article = (qid: string, revisionId: number): StructuredArticle => ({
  qid,
  title: qid,
  pageId: 1,
  revisionId,
  url: `https://en.wikipedia.org/wiki/${qid}`,
  description: null,
  sections: [],
});

describe("latestRevisionPerGame", () => {
  it("keeps one article per game, the newest revision, when a shard repeats a game", () => {
    const articles = [
      article("Q1", 10),
      article("Q2", 5),
      article("Q1", 12),
      article("Q1", 11),
    ];

    expect(
      latestRevisionPerGame(articles, (item) => item).map((item) => [
        item.qid,
        item.revisionId,
      ]),
    ).toEqual([
      ["Q1", 12],
      ["Q2", 5],
    ]);
  });
});

const store = CorpusStore.layer.pipe(
  Layer.provideMerge(
    SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) }),
  ),
  Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
  Layer.orDie,
);

const ingested = (revisionId: number, text: string) => ({
  article: article("Q1", revisionId),
  chunks: [
    { ordinal: 0, sectionPath: [], heading: "Q1", text, tokenEstimate: 1 },
  ],
});

layer(store)("CorpusStore embeddings", (it) => {
  it.effect(
    "drops a passage's embedding when a newer revision replaces it, so it is embedded again",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const corpus = yield* CorpusStore;
        yield* sql`INSERT INTO games (qid, title) VALUES ('Q1', 'Q1')`;
        yield* corpus.saveShard("first", [ingested(1, "old text")]);
        yield* corpus.saveEmbeddings([
          { passageId: "Q1#0", vector: new Uint8Array(4), scale: 1 },
        ]);
        assert.deepStrictEqual(yield* corpus.passagesToEmbedAfter(0, 10), []);

        yield* corpus.saveShard("second", [ingested(2, "new text")]);

        const pending = yield* corpus.passagesToEmbedAfter(0, 10);
        assert.deepStrictEqual(
          pending.map((passage) => [passage.id, passage.text]),
          [["Q1#0", "new text"]],
        );
        assert.strictEqual((yield* corpus.embeddingProgress).embedded, 0);
      }),
  );
});

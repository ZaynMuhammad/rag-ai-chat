import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  corpusFixture,
  japan,
  sovietUnion,
  unitedStates,
} from "@/server/corpus/CorpusFixture";
import type { Scope } from "@/server/games/Scope";
import { matchExpression, Retriever, searchTerms } from "./Retriever";

const fixture = corpusFixture([
  {
    qid: "Q1",
    title: "Tetris",
    released: "1985",
    origins: [sovietUnion],
    passages: [
      {
        heading: "Tetris",
        text: "Tetris is a puzzle video game created by Alexey Pajitnov in the Soviet Union.",
      },
      {
        heading: "Tetris > Legacy",
        text: "The game inspired many falling block puzzles.",
      },
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
        text: "Puyo Puyo is a falling block puzzle game developed by Compile.",
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
        heading: "Doom > Development",
        text: "id Software developed Doom, a first-person shooter, in Texas.",
      },
    ],
  },
]);

const search = (query: string, scope: Scope = {}) =>
  Effect.flatMap(Retriever, (retriever) =>
    retriever.search({ query, scope, limit: 5 }),
  ).pipe(Effect.map((passages) => passages.map((passage) => passage.id)));

describe("searchTerms", () => {
  it("drops question words and punctuation, folds case, and keeps years", () => {
    assert.deepStrictEqual(
      searchTerms("Who created TETRIS, and in what year? 1985!"),
      ["created", "tetris", "year", "1985"],
    );
  });

  it("quotes every term so FTS5 operators in user text stay plain words", () => {
    assert.strictEqual(
      matchExpression(searchTerms('NEAR("doom" AND OR) *')),
      '"near" OR "doom"',
    );
  });
});

layer(Retriever.layer.pipe(Layer.provideMerge(fixture)))("Retriever", (it) => {
  it.effect("ranks the passage that answers the question first", () =>
    Effect.gen(function* () {
      const [first] = yield* search("Who created Tetris?");
      assert.strictEqual(first, "Q1#0");
    }),
  );

  it.effect("matches stemmed forms of a word", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual((yield* search("developers")).sort(), [
        "Q2#0",
        "Q3#0",
      ]);
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
          from: 1980,
          to: 1989,
        })).sort(),
        ["Q1#0", "Q1#1"],
      );
      assert.deepStrictEqual(
        yield* search("falling block puzzle", { gameQid: "Q1" }),
        ["Q1#1", "Q1#0"],
      );
    }),
  );

  it.effect(
    "returns nothing, without querying, for a question with no searchable words",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* search("what is the?"), []);
      }),
  );
});

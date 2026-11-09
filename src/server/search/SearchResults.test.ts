import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  corpusFixture,
  japan,
  sovietUnion,
  unitedStates,
} from "@/server/corpus/CorpusFixture";
import {
  bestPassagePerGame,
  SearchResults,
  snippetSegments,
} from "./SearchResults";

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
        text: "Tetris inspired many falling block puzzle games, and Pajitnov kept designing puzzles.",
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
    title: "Script Kiddie",
    released: "2001",
    origins: [unitedStates],
    passages: [
      {
        heading: "Script Kiddie",
        text: 'Its title screen read <script>alert("pwned")</script> and <img src=x onerror=alert(1)> in the 2001 release.',
      },
    ],
  },
]);

const search = (query: string) =>
  Effect.flatMap(SearchResults, (results) => results.search(query));

describe("snippetSegments", () => {
  it("splits FTS5 match markers into matched and unmatched text", () => {
    assert.deepStrictEqual(
      snippetSegments("…the \u0002Tetris\u0003 game by \u0002Pajitnov\u0003"),
      [
        { text: "…the ", matched: false },
        { text: "Tetris", matched: true },
        { text: " game by ", matched: false },
        { text: "Pajitnov", matched: true },
      ],
    );
  });

  it("passes markup through as plain text, never as HTML", () => {
    assert.deepStrictEqual(snippetSegments("<b>\u0002x\u0003</b>"), [
      { text: "<b>", matched: false },
      { text: "x", matched: true },
      { text: "</b>", matched: false },
    ]);
  });
});

describe("bestPassagePerGame", () => {
  it("keeps the first, highest ranked passage of each game in rank order", () => {
    assert.deepStrictEqual(
      bestPassagePerGame([
        { qid: "Q1", id: "a" },
        { qid: "Q2", id: "b" },
        { qid: "Q1", id: "c" },
        { qid: "Q3", id: "d" },
        { qid: "Q2", id: "e" },
      ]).map((passage) => passage.id),
      ["a", "b", "d"],
    );
  });
});

layer(SearchResults.layer.pipe(Layer.provide(fixture)))(
  "SearchResults",
  (it) => {
    it.effect("returns each game once, with its best matching passage", () =>
      Effect.gen(function* () {
        const { results } = yield* search("falling block puzzle Tetris");
        assert.deepStrictEqual(
          results.map((hit) => [hit.qid, hit.passageId]),
          [
            ["Q1", "Q1#1"],
            ["Q2", "Q2#0"],
          ],
        );
        assert.isAbove(results[0]?.score ?? 0, results[1]?.score ?? 0);
      }),
    );

    it.effect("highlights the matched words, including stemmed forms", () =>
      Effect.gen(function* () {
        const { results } = yield* search("puzzles developer");
        const puyo = results.find((hit) => hit.qid === "Q2");
        assert.deepStrictEqual(
          puyo?.snippet.filter((segment) => segment.matched),
          [
            { text: "puzzle", matched: true },
            { text: "developed", matched: true },
          ],
        );
      }),
    );

    it.effect("returns stored markup as unmatched plain text segments", () =>
      Effect.gen(function* () {
        const { results } = yield* search("title screen 2001");
        const text = results[0]?.snippet.map((segment) => segment.text);
        assert.include(text?.join(""), '<script>alert("pwned")</script>');
        assert.include(text?.join(""), "<img src=x onerror=alert(1)>");
      }),
    );

    it.effect("feeds query term coverage of the top passage to the gate", () =>
      Effect.gen(function* () {
        const { signals } = yield* search("Pajitnov Soviet zeppelin");
        assert.closeTo(signals.termCoverage, 2 / 3, 1e-9);
        assert.strictEqual(signals.agreement, 1);
      }),
    );

    it.effect(
      "returns no results and hides the assist without searchable words",
      () =>
        Effect.gen(function* () {
          const page = yield* search("what is the?");
          assert.deepStrictEqual(page.results, []);
          assert.deepStrictEqual(page.assist, { show: false, confidence: 0 });
        }),
    );

    it.effect("hides the assist when nothing matches", () =>
      Effect.gen(function* () {
        const page = yield* search("zeppelin");
        assert.deepStrictEqual(page.results, []);
        assert.isFalse(page.assist.show);
      }),
    );
  },
);

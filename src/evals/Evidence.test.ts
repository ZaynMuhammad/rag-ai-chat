import { describe, expect, it } from "@effect/vitest";
import { EvalQuestion, GoldArticle } from "./EvalQuestion";
import {
  containsPhrase,
  evidencePassages,
  isResolved,
  normalizeText,
  resolveGold,
} from "./Evidence";

const question = (gold: ReadonlyArray<GoldArticle>) =>
  new EvalQuestion({
    id: "q1",
    source: "handwritten",
    question: "When was Red Dead Redemption released?",
    answers: ["May 2010"],
    answerable: true,
    gold,
    tags: [],
  });

const passage = (id: string, text: string) => ({
  id,
  gameQid: id.split("#")[0]!,
  text,
});

describe("containsPhrase", () => {
  it("matches whole words regardless of case and punctuation", () => {
    expect(
      containsPhrase("It was released on May 18, 2010.", "may 18 , 2010"),
    ).toBe(true);
    expect(containsPhrase("Released in 20100.", "2010")).toBe(false);
  });
});

describe("evidencePassages", () => {
  const tetris = [
    passage(
      "Q1#0",
      "Tetris is a puzzle video game created in 1985 by Alexey Pajitnov, a Soviet game designer who designed and programmed it.",
    ),
    passage(
      "Q1#1",
      "The game was released for the Game Boy in 1989 and sold millions of copies.",
    ),
  ];

  it("finds the passage an edited supporting sentence came from", () => {
    const sentence =
      "Tetris (Russian: Тетрис) is a tile-matching puzzle video game, originally designed and programmed by Russian game designer Alexey Pajitnov.";

    expect(evidencePassages(tetris, sentence).map((found) => found.id)).toEqual(
      ["Q1#0"],
    );
  });

  it("credits only the best-matching passage for a reworded sentence", () => {
    const sentence =
      "Tetris was released on the Game Boy in 1989 and sold millions.";

    expect(evidencePassages(tetris, sentence).map((found) => found.id)).toEqual(
      ["Q1#1"],
    );
  });

  it("requires a short answer to appear as a phrase", () => {
    expect(
      evidencePassages(tetris, "Game Boy").map((found) => found.id),
    ).toEqual(["Q1#1"]);
    expect(evidencePassages(tetris, "Sega Genesis")).toEqual([]);
  });

  it("rejects a sentence that shares too few terms with any passage", () => {
    const sentence =
      "Emiliana Torrini's song Jungle Drum was going to appear in the game but was cut.";

    expect(evidencePassages(tetris, sentence)).toEqual([]);
  });
});

describe("normalizeText", () => {
  it("folds full-width characters and strips punctuation", () => {
    expect(normalizeText("Ｐａｃ-Man!")).toBe("pac man");
  });
});

describe("resolveGold", () => {
  const passages = new Map([
    [
      "Q1",
      [
        passage("Q1#0", "Red Dead Redemption is a 2010 action-adventure game."),
        passage("Q1#3", "It was released in May 2010 for PlayStation 3."),
      ],
    ],
  ]);

  it("maps gold evidence onto the passages of the current chunking", () => {
    const resolution = resolveGold(
      question([
        new GoldArticle({
          qid: "Q1",
          title: "Red Dead Redemption",
          evidence: ["May 2010"],
        }),
      ]),
      passages,
    );

    expect([...resolution.goldPassageIds]).toEqual(["Q1#3"]);
    expect(isResolved(resolution)).toBe(true);
  });

  it("flags articles missing from the corpus and evidence that drifted out of the text", () => {
    const resolution = resolveGold(
      question([
        new GoldArticle({
          qid: "Q1",
          title: "Red Dead Redemption",
          evidence: ["Xbox One"],
        }),
        new GoldArticle({
          qid: "Q2",
          title: "Deleted Game",
          evidence: ["anything"],
        }),
      ]),
      passages,
    );

    expect(resolution.missingArticles).toEqual(["Q2"]);
    expect(resolution.articlesWithoutEvidence).toEqual(["Q1"]);
    expect(isResolved(resolution)).toBe(false);
  });
});

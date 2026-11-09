import { assert, describe, it } from "@effect/vitest";
import { commonTerms, countDocuments, words } from "./Terms";

describe("words", () => {
  it("folds case and width and splits on anything that is not a letter or digit", () => {
    assert.deepStrictEqual(words("Ｔｅｔｒｉｓ (Тетрис), 1985!"), [
      "tetris",
      "тетрис",
      "1985",
    ]);
  });
});

describe("commonTerms", () => {
  it("counts each word once per document and keeps those at or above the share", () => {
    const frequencies = new Map<string, number>();
    for (const document of [
      "the game the game",
      "a game",
      "the puzzle",
      "doom",
    ]) {
      countDocuments(frequencies, document);
    }
    assert.deepStrictEqual(commonTerms(frequencies, 4, 0.5), [
      { term: "game", documents: 2 },
      { term: "the", documents: 2 },
    ]);
  });
});

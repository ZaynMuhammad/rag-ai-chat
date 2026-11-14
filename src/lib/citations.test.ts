import { assert, describe, it } from "@effect/vitest";
import { answerSegments, citedNumbers } from "./citations";

describe("answerSegments", () => {
  it("splits an answer into text and citation markers", () => {
    assert.deepStrictEqual(answerSegments("Made in 1985 [1][3].", 3), [
      { kind: "text", text: "Made in 1985 " },
      { kind: "citation", number: 1 },
      { kind: "citation", number: 3 },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves a bracketed number that points at no source as plain text", () => {
    assert.deepStrictEqual(answerSegments("See [7].", 3), [
      { kind: "text", text: "See [7]." },
    ]);
    assert.deepStrictEqual([...citedNumbers("A [2] B [2] C [9]", 3)], [2]);
  });
});

describe("answerSegments with markdown emphasis", () => {
  it("drops the markers around an emphasised title", () => {
    assert.deepStrictEqual(
      answerSegments("The first *Metal Gear* and **Snatcher**.", 0),
      [{ kind: "text", text: "The first Metal Gear and Snatcher." }],
    );
  });

  it("keeps a citation that follows emphasis", () => {
    assert.deepStrictEqual(answerSegments("By **Hideo Kojima**[1].", 1), [
      { kind: "text", text: "By Hideo Kojima" },
      { kind: "citation", number: 1 },
      { kind: "text", text: "." },
    ]);
    assert.deepStrictEqual(answerSegments("_Metal Gear 2_ [1]", 1), [
      { kind: "text", text: "Metal Gear 2 " },
      { kind: "citation", number: 1 },
    ]);
  });

  it("leaves a lone asterisk alone", () => {
    assert.deepStrictEqual(answerSegments("A 5 * 3 grid, rated 4*.", 0), [
      { kind: "text", text: "A 5 * 3 grid, rated 4*." },
    ]);
  });

  it("leaves underscores inside a word alone", () => {
    assert.deepStrictEqual(
      answerSegments("Saved as metal_gear_msx and _Snatcher_.", 0),
      [{ kind: "text", text: "Saved as metal_gear_msx and Snatcher." }],
    );
  });
});

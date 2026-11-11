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

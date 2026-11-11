import { assert, describe, it } from "@effect/vitest";
import { extractiveAnswer, notCovered } from "./ExtractiveAnswer";

describe("extractiveAnswer", () => {
  it("quotes only sentences sharing two words with a question of three or more terms, and cites each", () => {
    const answer = extractiveAnswer({
      question: "Who created Tetris, and for which computer?",
      passages: [
        {
          number: 1,
          text: "Tetris is a puzzle game. It was created by Alexey Pajitnov in 1985.",
        },
        { number: 2, text: "Tetris was created for the Electronika 60." },
        { number: 3, text: "Doom is a shooter." },
      ],
    });
    assert.strictEqual(
      answer,
      "Tetris was created for the Electronika 60. [2]",
    );
  });

  it("says the articles don't cover it when no sentence shares a word with the question", () => {
    assert.strictEqual(
      extractiveAnswer({
        question: "Who composed the soundtrack?",
        passages: [{ number: 1, text: "Doom is a shooter." }],
      }),
      notCovered,
    );
  });
});

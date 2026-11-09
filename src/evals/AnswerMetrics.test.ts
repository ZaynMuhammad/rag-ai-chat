import { assert, describe, it } from "@effect/vitest";
import { notCovered } from "@/server/provider/ExtractiveAnswer";
import {
  answerSentences,
  type AnswerUnderTest,
  containsAnswer,
  isAbstention,
  scoreAnswer,
  summarizeAnswers,
  tokenF1,
} from "./AnswerMetrics";

const passages = [
  {
    id: "tetris-1",
    gameQid: "Q1",
    text: "Tetris was created by Alexey Pajitnov in 1985.",
  },
  {
    id: "tetris-2",
    gameQid: "Q1",
    text: "It ran first on the Electronika 60.",
  },
  {
    id: "puyo-1",
    gameQid: "Q2",
    text: "Puyo Puyo was inspired by Tetris.",
  },
];

const run = (overrides: Partial<AnswerUnderTest>): AnswerUnderTest => ({
  answerable: true,
  answers: ["Alexey Pajitnov"],
  goldGameQids: new Set(["Q1", "Q2"]),
  goldPassageIds: new Set(["tetris-1", "puyo-1"]),
  passages,
  answer: "",
  failed: false,
  ...overrides,
});

describe("answerSentences", () => {
  it("attaches a citation to the sentence it follows, before or after the full stop", () => {
    assert.deepStrictEqual(
      answerSentences(
        "Pajitnov made Tetris. [1] It ran on the Electronika 60 [2][3]. Then it spread.",
      ),
      [
        { text: "Pajitnov made Tetris.", citations: [1] },
        { text: "It ran on the Electronika 60 .", citations: [2, 3] },
        { text: "Then it spread.", citations: [] },
      ],
    );
  });
});

describe("isAbstention", () => {
  it("recognizes the mock's refusal and the ways a model says the passages don't cover it", () => {
    assert.isTrue(isAbstention(notCovered));
    assert.isTrue(
      isAbstention("The passages do not mention when it was released."),
    );
    assert.isTrue(isAbstention("The articles don’t\nsay who composed it."));
    assert.isFalse(isAbstention("Tetris was covered by every magazine. [1]"));
  });
});

describe("answer correctness", () => {
  it("contains a gold answer whole, ignoring case, accents, articles and punctuation", () => {
    assert.isTrue(containsAnswer("It's a Pokemon game.", "Pokémon"));
    assert.isTrue(containsAnswer("Made by the Mojang team", "Mojang"));
    assert.isTrue(
      containsAnswer("Out on November 4, 2014.", "November 4 , 2014"),
    );
    assert.isFalse(containsAnswer("A lion appears.", "Ion"));
  });

  it("scores token F1, so a long answer that contains the gold one still loses precision", () => {
    assert.strictEqual(tokenF1("The Alexey Pajitnov", "alexey pajitnov"), 1);
    assert.closeTo(
      tokenF1("Tetris was made by Alexey Pajitnov", "Alexey Pajitnov"),
      0.5,
      1e-9,
    );
    assert.strictEqual(tokenF1("Doom", "Alexey Pajitnov"), 0);
  });
});

describe("scoreAnswer", () => {
  it("scores citations and lexical support against the passages that were sent", () => {
    const scored = scoreAnswer(
      run({
        answer:
          "Alexey Pajitnov created Tetris. [1] It was released on the Electronika 60 [2]. It sold millions. [9]",
      }),
    );
    assert.strictEqual(scored.answerContainment, 1);
    assert.closeTo(scored.citationValidity ?? -1, 2 / 3, 1e-9);
    assert.strictEqual(scored.citationPrecision, 0.5);
    assert.strictEqual(scored.citationRecall, 0.5);
    assert.closeTo(scored.uncitedSentenceRate ?? -1, 1 / 3, 1e-9);
    assert.closeTo(scored.faithfulness ?? -1, (1 + 2 / 3 + 0) / 3, 1e-9);
    assert.isFalse(scored.abstained);
    assert.isTrue(scored.goldPassageSent);
  });

  it("counts an abstention on an answerable question as a miss with no claims to check", () => {
    const scored = scoreAnswer(run({ answer: notCovered }));
    assert.isTrue(scored.abstained);
    assert.strictEqual(scored.answerContainment, 0);
    assert.strictEqual(scored.citationRecall, 0);
    assert.isNull(scored.citationPrecision);
    assert.isNull(scored.citationValidity);
    assert.isNull(scored.uncitedSentenceRate);
    assert.isNull(scored.faithfulness);
  });

  it("leaves correctness and gold citation scores out for an unanswerable question", () => {
    const scored = scoreAnswer(
      run({
        answerable: false,
        answers: [],
        goldGameQids: new Set(),
        goldPassageIds: new Set(),
        answer: "Puyo Puyo was inspired by Tetris. [3]",
      }),
    );
    assert.isFalse(scored.abstained);
    assert.isNull(scored.answerContainment);
    assert.isNull(scored.citationPrecision);
    assert.isNull(scored.citationRecall);
    assert.isNull(scored.goldPassageSent);
    assert.strictEqual(scored.faithfulness, 1);
  });
});

describe("summarizeAnswers", () => {
  it("rates abstention separately for unanswerable and answerable questions", () => {
    const answered = scoreAnswer(
      run({ answer: "Alexey Pajitnov created Tetris. [1]" }),
    );
    const wronglyAbstained = scoreAnswer(run({ answer: notCovered }));
    const unanswerable = run({
      answerable: false,
      answers: [],
      goldGameQids: new Set(),
      goldPassageIds: new Set(),
    });
    const abstained = scoreAnswer({ ...unanswerable, answer: notCovered });
    const confabulated = scoreAnswer({
      ...unanswerable,
      answer: "Puyo Puyo was inspired by Tetris. [3]",
    });
    const summary = summarizeAnswers([
      { answerable: true, ...answered },
      { answerable: true, ...wronglyAbstained },
      { answerable: false, ...abstained },
      { answerable: false, ...confabulated },
    ]);
    assert.strictEqual(summary.correctAbstention, 0.5);
    assert.strictEqual(summary.falseAbstention, 0.5);
    assert.strictEqual(summary.answerContainment, 0.5);
    assert.strictEqual(summary.failureRate, 0);
  });
});

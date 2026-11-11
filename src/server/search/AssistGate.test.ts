import { assert, describe, it } from "@effect/vitest";
import { assistConfidence, assistDecision, assistSignals } from "./AssistGate";

const passages = (...games: ReadonlyArray<[string, number]>) =>
  games.map(([gameQid, score]) => ({ gameQid, score }));

describe("assistSignals", () => {
  it("measures the margin against the best passage from a different game", () => {
    const signals = assistSignals(
      passages(["Q1", 40], ["Q1", 38], ["Q2", 30], ["Q3", 10]),
      2,
      2,
    );
    assert.strictEqual(signals.topScore, 40);
    assert.strictEqual(signals.margin, 0.25);
  });

  it("counts agreement over the top six passages only", () => {
    const signals = assistSignals(
      passages(
        ["Q1", 9],
        ["Q1", 8],
        ["Q2", 7],
        ["Q1", 6],
        ["Q3", 5],
        ["Q4", 4],
        ["Q1", 3],
        ["Q1", 2],
      ),
      1,
      1,
    );
    assert.strictEqual(signals.agreement, 0.5);
  });

  it("treats a single matching game as fully decisive", () => {
    assert.strictEqual(
      assistSignals(passages(["Q1", 12], ["Q1", 11]), 1, 2).margin,
      1,
    );
  });

  it("gives no margin when every passage scores zero", () => {
    assert.strictEqual(
      assistSignals(passages(["Q1", 0], ["Q2", 0]), 1, 1).margin,
      0,
    );
  });

  it("is all zeros when nothing was retrieved", () => {
    assert.deepStrictEqual(assistSignals([], 0, 3), {
      topScore: 0,
      margin: 0,
      termCoverage: 0,
      agreement: 0,
    });
  });
});

describe("assistDecision", () => {
  it("shows an answer when one game clearly answers every query term", () => {
    const decision = assistDecision(
      assistSignals(
        passages(["Q1", 45], ["Q1", 40], ["Q1", 38], ["Q2", 20]),
        3,
        3,
      ),
    );
    assert.isTrue(decision.show);
    assert.strictEqual(decision.confidence, (1 + 1 + 1 + 0.75) / 4);
  });

  it("hides the answer when many games tie on a weak match", () => {
    const decision = assistDecision(
      assistSignals(
        passages(
          ["Q1", 16],
          ["Q2", 15.5],
          ["Q3", 15],
          ["Q4", 14.5],
          ["Q5", 14],
          ["Q6", 13.5],
        ),
        4,
        6,
      ),
    );
    assert.isFalse(decision.show);
    assert.isBelow(decision.confidence, 0.5);
  });

  it("hides a strong, decisive match that misses most of the query", () => {
    assert.isFalse(
      assistDecision(
        assistSignals(passages(["Q1", 30], ["Q1", 28], ["Q2", 10]), 1, 4),
      ).show,
    );
  });

  it("caps each signal so one huge score cannot carry the decision", () => {
    const confidence = assistConfidence({
      topScore: 400,
      margin: 0,
      termCoverage: 0,
      agreement: 0,
    });
    assert.strictEqual(confidence, 0.25);
  });

  it("shows at the threshold and hides just below it", () => {
    const signals = {
      topScore: 40,
      margin: 0.25,
      termCoverage: 0.8,
      agreement: 0,
    };
    const confidence = assistConfidence(signals);
    assert.isTrue(assistDecision(signals, confidence).show);
    assert.isFalse(assistDecision(signals, confidence + 0.001).show);
  });
});

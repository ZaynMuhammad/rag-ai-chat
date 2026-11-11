import { assert, describe, it } from "@effect/vitest";
import { type GateOptions, regressions } from "./RegressionGate";

const options: GateOptions = {
  tolerance: 0.02,
  minimumQuestions: 20,
  lowerIsBetter: new Set(["falseAbstention"]),
  ungated: new Set(["questions"]),
};

const baseline = {
  all: {
    questions: 100,
    answerContainment: 0.5,
    falseAbstention: 0.1,
    citationPrecision: 0.4,
  },
  "tag:future": { questions: 3, answerContainment: 0.67 },
};

describe("regressions", () => {
  it("passes drops within tolerance and any improvement", () => {
    assert.deepStrictEqual(
      regressions(
        baseline,
        {
          all: {
            questions: 100,
            answerContainment: 0.48,
            falseAbstention: 0.05,
            citationPrecision: 0.9,
          },
          "tag:future": { questions: 3, answerContainment: 0.67 },
        },
        options,
      ),
      [],
    );
  });

  it("fails a drop past tolerance, a rise in a lower-is-better metric, and a metric that vanished", () => {
    assert.deepStrictEqual(
      regressions(
        baseline,
        {
          all: {
            questions: 100,
            answerContainment: 0.47,
            falseAbstention: 0.13,
            citationPrecision: null,
          },
          "tag:future": { questions: 3, answerContainment: 0 },
        },
        options,
      ),
      [
        {
          group: "all",
          metric: "answerContainment",
          baseline: 0.5,
          fresh: 0.47,
        },
        { group: "all", metric: "falseAbstention", baseline: 0.1, fresh: 0.13 },
        {
          group: "all",
          metric: "citationPrecision",
          baseline: 0.4,
          fresh: null,
        },
      ],
    );
  });

  it("fails when the question set changed, since the numbers no longer compare", () => {
    assert.deepStrictEqual(
      regressions(
        baseline,
        { all: { ...baseline.all, questions: 99 } },
        options,
      ),
      [
        { group: "all", metric: "questions", baseline: 100, fresh: 99 },
        {
          group: "tag:future",
          metric: "questions",
          baseline: 3,
          fresh: null,
        },
      ],
    );
  });
});

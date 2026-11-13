import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Layer } from "effect";
import { CorpusStore } from "../../src/corpus/CorpusStore";
import { resolveGold } from "../../src/evals/Evidence";
import {
  type GateSample,
  gateCost,
  gateCurve,
  gatePoint,
  operatingPoint,
  rocAuc,
} from "../../src/evals/GateCurve";
import { passagesPerAnswer } from "../../src/server/chat/GroundedChat";
import {
  assistThreshold,
  type AssistSignals,
  decisiveMargin,
  strongScore,
} from "../../src/server/search/AssistGate";
import { Retriever } from "../../src/server/search/Retriever";
import { SearchResults } from "../../src/server/search/SearchResults";
import { CorpusDatabase } from "../corpus/CorpusDatabase";
import { evalDirectory, loadEvalSets } from "./EvalSet";

const wrongAnswerCost = 4;
const costSensitivity = [1, 2, 3, 4, 5, 6, 8];

interface Judged extends GateSample {
  readonly id: string;
  readonly tags: ReadonlyArray<string>;
  readonly signals: AssistSignals;
}

const signalNames = [
  "topScore",
  "margin",
  "termCoverage",
  "agreement",
] as const;

const aucOf = (
  judged: ReadonlyArray<Judged>,
  score: (sample: Judged) => number,
) =>
  Number(
    rocAuc(
      judged.map((sample) => ({
        score: score(sample),
        positive: sample.shouldShow,
      })),
    ).toFixed(3),
  );

const splitHalf = (judged: ReadonlyArray<Judged>) =>
  [0, 1].map((half) => {
    const tune = judged.filter((_, index) => index % 2 === half);
    const test = judged.filter((_, index) => index % 2 !== half);
    const chosen = operatingPoint(gateCurve(tune), wrongAnswerCost);
    return {
      tunedOn: half === 0 ? "even" : "odd",
      threshold: chosen?.threshold ?? null,
      tune: chosen ?? null,
      test: chosen === undefined ? null : gatePoint(test, chosen.threshold),
    };
  });

const byGroup = (judged: ReadonlyArray<Judged>, threshold: number) => {
  const groups = new Map<string, Array<Judged>>();
  for (const sample of judged) {
    const keys = sample.answerable
      ? [sample.shouldShow ? "evidence in top 6" : "evidence not in top 6"]
      : sample.tags.filter((tag) => tag !== "unanswerable");
    for (const key of keys)
      groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return Object.fromEntries(
    [...groups].map(([key, group]) => [
      key,
      {
        questions: group.length,
        shown: group.filter((sample) => sample.confidence >= threshold).length,
      },
    ]),
  );
};

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const store = yield* CorpusStore;
  const search = yield* SearchResults;
  const retriever = yield* Retriever;
  const questions = (yield* loadEvalSets).flatMap((set) => set.questions);
  const passagesByGame = Map.groupBy(
    yield* store.passagesOf([
      ...new Set(questions.flatMap((q) => q.gold.map((g) => g.qid))),
    ]),
    (passage) => passage.gameQid,
  );

  const judged: ReadonlyArray<Judged> = yield* Effect.forEach(
    questions,
    (question) =>
      Effect.gen(function* () {
        const page = yield* search.search(question.question);
        const answeredFrom = yield* retriever.search({
          query: question.question,
          scope: {},
          limit: passagesPerAnswer,
        });
        const gold = resolveGold(question, passagesByGame).goldPassageIds;
        return {
          id: question.id,
          tags: question.tags,
          answerable: question.answerable,
          shouldShow:
            question.answerable &&
            answeredFrom.some((passage) => gold.has(passage.id)),
          confidence: Number(page.assist.confidence.toFixed(4)),
          signals: page.signals,
        };
      }),
  );

  const curve = gateCurve(judged);
  const selected = operatingPoint(curve, wrongAnswerCost);
  const configured = gatePoint(judged, assistThreshold);
  const positives = judged.filter((sample) => sample.shouldShow).length;

  console.table(
    curve.map(({ precisionInterval, ...point }) => ({
      ...point,
      precisionInterval: precisionInterval.join("–"),
    })),
  );
  console.log(
    `configured threshold ${assistThreshold}; a wrong answer costing ${wrongAnswerCost}x a missing one selects ${selected?.threshold ?? "none"}`,
  );

  yield* fs.makeDirectory(`${evalDirectory}results`, { recursive: true });
  yield* fs.writeFileString(
    `${evalDirectory}results/assist-gate.json`,
    `${JSON.stringify(
      {
        corpus: yield* store.stats,
        label: `answerable, and the ${passagesPerAnswer} passages the grounded answer is built from contain gold evidence`,
        questions: judged.length,
        shouldShow: positives,
        shouldHide: {
          evidenceNotRetrieved: judged.filter(
            (sample) => sample.answerable && !sample.shouldShow,
          ).length,
          unanswerable: judged.filter((sample) => !sample.answerable).length,
        },
        confidence: {
          formula: `mean of min(1, topScore / ${strongScore}), min(1, margin / ${decisiveMargin}), termCoverage, agreement`,
          auc: aucOf(judged, (sample) => sample.confidence),
          signalAuc: Object.fromEntries(
            signalNames.map((name) => [
              name,
              aucOf(judged, (sample) => sample.signals[name]),
            ]),
          ),
        },
        rule: `minimise ${wrongAnswerCost} x wrongShown + missed`,
        selected: selected ?? null,
        configured,
        configuredByGroup: byGroup(judged, assistThreshold),
        splitHalf: splitHalf(judged),
        costSensitivity: costSensitivity.map((cost) => {
          const point = operatingPoint(curve, cost);
          return {
            wrongAnswerCost: cost,
            threshold: point?.threshold ?? null,
            cost: point === undefined ? null : gateCost(point, cost),
            precision: point?.precision ?? null,
            recall: point?.recall ?? null,
            triggerRate: point?.triggerRate ?? null,
          };
        }),
        curve,
        perQuestion: judged.map(({ id, shouldShow, confidence }) => ({
          id,
          shouldShow,
          confidence,
        })),
      },
      null,
      2,
    )}\n`,
  );
});

BunRuntime.runMain(
  program.pipe(
    Effect.provide(
      Layer.mergeAll(SearchResults.layer, Retriever.layer).pipe(
        Layer.provideMerge(CorpusDatabase),
        Layer.provideMerge(BunServices.layer),
      ),
    ),
  ),
);

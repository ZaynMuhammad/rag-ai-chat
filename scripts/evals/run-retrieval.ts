import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Clock, Effect, FileSystem, Layer } from "effect";
import { CorpusStore } from "../../src/corpus/CorpusStore";
import type { EvalQuestion } from "../../src/evals/EvalQuestion";
import { resolveGold } from "../../src/evals/Evidence";
import {
  articleRecallAtK,
  mean,
  passageHitAtK,
  reciprocalRank,
  type Judgement,
  type RetrievedPassage,
} from "../../src/evals/RetrievalMetrics";
import { Retriever } from "../../src/server/search/Retriever";
import { CorpusDatabase } from "../corpus/CorpusDatabase";
import { evalDirectory, loadEvalSets } from "./EvalSet";

const depth = 20;
const headingWeights = [1, 2, 4] as const;
const defaultHeadingWeight = 2;

interface Scored {
  readonly question: EvalQuestion;
  readonly ranking: ReadonlyArray<RetrievedPassage>;
  readonly judgement: Judgement;
  readonly millis: number;
}

const percentile = (values: ReadonlyArray<number>, p: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return (
    sorted.at(Math.min(sorted.length - 1, Math.floor(p * sorted.length))) ?? 0
  );
};

const round = (value: number) => Number(value.toFixed(3));

const hitAt = (scored: ReadonlyArray<Scored>, k: number) =>
  round(
    mean(scored.map((s) => Number(passageHitAtK(s.ranking, s.judgement, k)))),
  );

const articleRecallAt = (scored: ReadonlyArray<Scored>, k: number) =>
  round(mean(scored.map((s) => articleRecallAtK(s.ranking, s.judgement, k))));

const metrics = (scored: ReadonlyArray<Scored>) => ({
  questions: scored.length,
  "hit@5": hitAt(scored, 5),
  "hit@10": hitAt(scored, 10),
  "hit@20": hitAt(scored, 20),
  "articleRecall@5": articleRecallAt(scored, 5),
  "articleRecall@10": articleRecallAt(scored, 10),
  "articleRecall@20": articleRecallAt(scored, 20),
  mrr: round(mean(scored.map((s) => reciprocalRank(s.ranking, s.judgement)))),
  p50ms: round(
    percentile(
      scored.map((s) => s.millis),
      0.5,
    ),
  ),
  p99ms: round(
    percentile(
      scored.map((s) => s.millis),
      0.99,
    ),
  ),
});

const breakdown = (scored: ReadonlyArray<Scored>) => {
  const groups = new Map<string, Array<Scored>>([["all", [...scored]]]);
  for (const entry of scored) {
    for (const key of [
      `source:${entry.question.source}`,
      ...entry.question.tags.map((tag) => `tag:${tag}`),
    ]) {
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
  }
  return Object.fromEntries(
    [...groups].map(([key, group]) => [key, metrics(group)]),
  );
};

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const store = yield* CorpusStore;
  const questions = (yield* loadEvalSets)
    .flatMap((set) => set.questions)
    .filter((question) => question.answerable);
  const goldQids = [
    ...new Set(questions.flatMap((q) => q.gold.map((g) => g.qid))),
  ];
  const passagesByGame = Map.groupBy(
    yield* store.passagesOf(goldQids),
    (p) => p.gameQid,
  );

  const judged = questions.map((question) => ({
    question,
    judgement: {
      goldPassageIds: resolveGold(question, passagesByGame).goldPassageIds,
      goldGameQids: new Set(question.gold.map((gold) => gold.qid)),
    },
  }));

  const runs = yield* Effect.forEach(headingWeights, (headingWeight) =>
    Effect.gen(function* () {
      const retriever = yield* Retriever.make({ headingWeight });
      const scored = yield* Effect.forEach(judged, ({ question, judgement }) =>
        Effect.gen(function* () {
          const start = yield* Clock.currentTimeNanos;
          const ranking = yield* retriever.search({
            query: question.question,
            scope: {},
            limit: depth,
          });
          const millis = Number((yield* Clock.currentTimeNanos) - start) / 1e6;
          return { question, ranking, judgement, millis };
        }),
      );
      return { retriever: "bm25", headingWeight, results: breakdown(scored) };
    }),
  );

  console.table(
    runs.map((run) => ({
      headingWeight: run.headingWeight,
      ...run.results["all"],
    })),
  );
  const best = runs.find((run) => run.headingWeight === defaultHeadingWeight);
  if (best !== undefined) {
    console.table(
      Object.entries(best.results).map(([group, values]) => ({
        group,
        questions: values.questions,
        "hit@5": values["hit@5"],
        "hit@20": values["hit@20"],
        "articleRecall@20": values["articleRecall@20"],
        mrr: values.mrr,
      })),
    );
  }

  const stats = yield* store.stats;
  yield* fs.makeDirectory(`${evalDirectory}results`, { recursive: true });
  yield* fs.writeFileString(
    `${evalDirectory}results/retrieval.json`,
    `${JSON.stringify({ corpus: stats, depth, runs }, null, 2)}\n`,
  );
});

BunRuntime.runMain(
  program.pipe(
    Effect.provide(Layer.provideMerge(CorpusDatabase, BunServices.layer)),
  ),
);

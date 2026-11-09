import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Clock, Context, Effect, FileSystem, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
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
import { DenseIndex } from "../../src/server/search/DenseIndex";
import { Embedder, embeddingModel } from "../../src/server/search/Embedder";
import {
  defaultFusionOptions,
  defaultRetrievalMode,
  defaultRetrieverOptions,
  type FusionOptions,
  Retriever,
  type RetrieverOptions,
} from "../../src/server/search/Retriever";
import { CorpusDatabase, dataDirectory } from "../corpus/CorpusDatabase";
import { evalDirectory, loadEvalSets } from "./EvalSet";

const depth = 20;
interface Variant {
  readonly name: string;
  readonly options: RetrieverOptions;
  readonly fusion: FusionOptions | null;
}

const variants: ReadonlyArray<Variant> = [
  { name: "bm25", options: defaultRetrieverOptions, fusion: null },
  ...[0.2, 0.1, 0.05, 0.02].map((share) => ({
    name: `bm25, require a word in <${share * 100}% of passages`,
    options: { ...defaultRetrieverOptions, commonTermShare: share },
    fusion: null,
  })),
  {
    name: "dense",
    options: defaultRetrieverOptions,
    fusion: { ...defaultFusionOptions, mode: "dense" },
  },
  ...[60, 10, 30, 120].map((k) => ({
    name: `hybrid, rrf k=${k}`,
    options: defaultRetrieverOptions,
    fusion: { ...defaultFusionOptions, k },
  })),
  {
    name: "hybrid, rrf k=60, bm25 requires a word in <2% of passages",
    options: { ...defaultRetrieverOptions, commonTermShare: 0.02 },
    fusion: defaultFusionOptions,
  },
];

const comparedVariants = ["bm25", "dense", "hybrid, rrf k=60"];

const residentMegabytes = () =>
  Effect.sync(() => round(process.memoryUsage().rss / 1e6));

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

  const sql = yield* SqlClient.SqlClient;
  const storedVectorBytes = yield* SqlSchema.findOne({
    Request: Schema.Void,
    Result: Schema.Struct({ bytes: Schema.Number }),
    execute: () => sql`
      SELECT COALESCE(SUM(length(vector)) + COUNT(*) * 8, 0) AS bytes
      FROM passage_embeddings
    `,
  })(undefined);

  const rssBeforeDense = yield* residentMegabytes();
  const loadStart = yield* Clock.currentTimeMillis;
  const denseContext = yield* Layer.build(
    DenseIndex.layer.pipe(
      Layer.provide(
        Embedder.onnx({
          modelDirectory: `${dataDirectory}models`,
          allowDownload: false,
        }),
      ),
    ),
  );
  const dense = Context.get(denseContext, DenseIndex);
  const denseIndex = {
    ...dense.size,
    megabytes: round(dense.size.bytes / 1e6),
    storedMegabytes: round(storedVectorBytes.bytes / 1e6),
    loadSeconds: round(((yield* Clock.currentTimeMillis) - loadStart) / 1000),
    residentMegabytesBefore: rssBeforeDense,
    residentMegabytesAfter: yield* residentMegabytes(),
  };

  const runs = yield* Effect.forEach(variants, ({ name, options, fusion }) =>
    Effect.gen(function* () {
      const retriever = yield* (
        fusion === null
          ? Retriever.make(options)
          : Retriever.makeFused(options, fusion)
      ).pipe(Effect.provide(denseContext));
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
      return {
        variant: name,
        options,
        fusion,
        results: breakdown(scored),
      };
    }),
  );

  console.table(
    runs.map((run) => ({
      variant: run.variant,
      ...run.results["all"],
    })),
  );
  const compared = runs.filter((run) => comparedVariants.includes(run.variant));
  const groups = Object.keys(compared[0]?.results ?? {});
  console.table(
    groups.map((group) => ({
      group,
      questions: compared[0]?.results[group]?.questions,
      ...Object.fromEntries(
        compared.flatMap((run) => [
          [`${run.variant} hit@5`, run.results[group]?.["hit@5"]],
          [`${run.variant} mrr`, run.results[group]?.mrr],
        ]),
      ),
    })),
  );
  console.table([denseIndex]);

  const stats = yield* store.stats;
  const embedding = yield* store.embeddingProgress;
  yield* fs.makeDirectory(`${evalDirectory}results`, { recursive: true });
  yield* fs.writeFileString(
    `${evalDirectory}results/retrieval.json`,
    `${JSON.stringify(
      {
        corpus: stats,
        embedding: {
          model: embeddingModel,
          passages: embedding.passages,
          embedded: embedding.embedded,
        },
        defaultMode: defaultRetrievalMode,
        depth,
        denseIndex,
        runs,
      },
      null,
      2,
    )}\n`,
  );
});

BunRuntime.runMain(
  Effect.scoped(program).pipe(
    Effect.provide(Layer.provideMerge(CorpusDatabase, BunServices.layer)),
  ),
);

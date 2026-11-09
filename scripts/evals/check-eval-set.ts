import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Layer, Schema } from "effect";
import { CorpusStore } from "../../src/corpus/CorpusStore";
import type { EvalQuestion } from "../../src/evals/EvalQuestion";
import { resolveGold, type GoldResolution } from "../../src/evals/Evidence";
import { CorpusDatabase } from "../corpus/CorpusDatabase";
import { loadEvalSets } from "./EvalSet";

class EvalSetDrift extends Schema.TaggedError<EvalSetDrift>()("EvalSetDrift", {
  unresolved: Schema.Array(Schema.String),
}) {}

const percent = (part: number, whole: number) =>
  whole === 0 ? "n/a" : `${((100 * part) / whole).toFixed(1)}%`;

const summarize = (
  label: string,
  results: ReadonlyArray<{
    question: EvalQuestion;
    resolution: GoldResolution;
  }>,
) => {
  const answerable = results.filter(({ question }) => question.answerable);
  const goldArticles = answerable.flatMap(({ question }) => question.gold);
  const missing = answerable.reduce(
    (total, { resolution }) => total + resolution.missingArticles.length,
    0,
  );
  const withoutEvidence = answerable.reduce(
    (total, { resolution }) =>
      total + resolution.articlesWithoutEvidence.length,
    0,
  );
  const goldPassages = answerable.reduce(
    (total, { resolution }) => total + resolution.goldPassageIds.size,
    0,
  );
  return {
    set: label,
    questions: results.length,
    answerable: answerable.length,
    unanswerable: results.length - answerable.length,
    goldArticles: goldArticles.length,
    articlesInCorpus: percent(
      goldArticles.length - missing,
      goldArticles.length,
    ),
    evidenceResolved: percent(
      goldArticles.length - missing - withoutEvidence,
      goldArticles.length,
    ),
    goldPassagesPerQuestion:
      answerable.length === 0
        ? 0
        : Number((goldPassages / answerable.length).toFixed(2)),
  };
};

const program = Effect.gen(function* () {
  const store = yield* CorpusStore;
  const sets = yield* loadEvalSets;

  const goldQids = [
    ...new Set(
      sets.flatMap(({ questions }) =>
        questions.flatMap((q) => q.gold.map((g) => g.qid)),
      ),
    ),
  ];
  const passagesByGame = Map.groupBy(
    yield* store.passagesOf(goldQids),
    (passage) => passage.gameQid,
  );

  const resolvedSets = sets.map(({ file, questions }) => ({
    file,
    results: questions.map((question) => ({
      question,
      resolution: resolveGold(question, passagesByGame),
    })),
  }));
  const all = resolvedSets.flatMap(({ results }) => results);
  console.table([
    ...resolvedSets.map(({ file, results }) => summarize(file, results)),
    summarize("all", all),
  ]);

  const unresolved = all
    .filter(({ question, resolution }) =>
      question.answerable
        ? resolution.missingArticles.length +
            resolution.articlesWithoutEvidence.length >
          0
        : question.gold.length > 0,
    )
    .map(({ question }) => question.id);
  if (unresolved.length > 0) return yield* new EvalSetDrift({ unresolved });
});

BunRuntime.runMain(
  program.pipe(
    Effect.provide(Layer.provideMerge(CorpusDatabase, BunServices.layer)),
  ),
);

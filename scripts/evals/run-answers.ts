import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
  Config,
  Duration,
  Effect,
  ExecutionPlan,
  FileSystem,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect";
import { CorpusStore } from "../../src/corpus/CorpusStore";
import {
  type AnswerSummary,
  type ScoredAnswer,
  summarizeAnswers,
  scoreAnswer,
} from "../../src/evals/AnswerMetrics";
import type { EvalQuestion } from "../../src/evals/EvalQuestion";
import { resolveGold } from "../../src/evals/Evidence";
import {
  type FaithfulnessScore,
  judgeFaithfulness,
  judgePrompt,
} from "../../src/evals/FaithfulnessJudge";
import {
  type GateOptions,
  type GroupResults,
  regressions,
} from "../../src/evals/RegressionGate";
import { mean } from "../../src/evals/RetrievalMetrics";
import type { ChatEvent } from "../../src/server/chat/ChatProtocol";
import {
  type ChatPlan,
  GroundedChat,
  passagesPerAnswer,
} from "../../src/server/chat/GroundedChat";
import { groundedPrompt } from "../../src/server/chat/GroundedPrompt";
import {
  anthropic,
  firstTokenDeadline,
} from "../../src/server/provider/ChatModels";
import { CircuitBreaker } from "../../src/server/provider/CircuitBreaker";
import { MockProvider } from "../../src/server/provider/MockProvider";
import type { RetrievedPassage } from "../../src/server/search/Passage";
import { Retriever } from "../../src/server/search/Retriever";
import { CorpusDatabase } from "../corpus/CorpusDatabase";
import { evalDirectory, groupsOf, loadEvalSets } from "./EvalSet";

const gate: GateOptions = {
  tolerance: 0.02,
  minimumQuestions: 20,
  lowerIsBetter: new Set([
    "failureRate",
    "uncitedSentenceRate",
    "falseAbstention",
  ]),
  ungated: new Set(["questions", "answerable", "unanswerable"]),
};

const haikuDollarsPerMillion = { input: 0.1, output: 0.5 };
const charsPerToken = 3.5;
const answerMaxTokens = 1024;
const judgeMaxTokens = 4096;

class AnswerRegression extends Schema.TaggedError<AnswerRegression>()(
  "AnswerRegression",
  { message: Schema.String },
) {}

class SpendNotCapped extends Schema.TaggedError<SpendNotCapped>()(
  "SpendNotCapped",
  { message: Schema.String },
) {}

const CommittedResults = Schema.fromJsonString(
  Schema.Struct({
    results: Schema.Record(
      Schema.String,
      Schema.Record(Schema.String, Schema.NullOr(Schema.Number)),
    ),
  }),
);

const settings = Config.all({
  provider: Config.Literals(["mock", "anthropic"], "EVAL_PROVIDER").pipe(
    Config.withDefault("mock"),
  ),
  judge: Config.Literals(["none", "anthropic"], "EVAL_JUDGE").pipe(
    Config.withDefault("none"),
  ),
  model: Config.String("EVAL_MODEL").pipe(
    Config.withDefault("claude-haiku-5-5"),
  ),
  limit: Config.option(Config.Int("EVAL_LIMIT")),
});

const evenlySpaced = <A>(items: ReadonlyArray<A>, limit: number) =>
  limit >= items.length
    ? items
    : Array.from({ length: limit }, (_, index) =>
        items.slice(Math.floor((index * items.length) / limit)).at(0),
      ).filter((item) => item !== undefined);

const round = (value: number | null) =>
  value === null ? null : Number(value.toFixed(3));

const roundAll = <K extends string>(
  record: Readonly<Record<K, number | null>>,
) =>
  Object.fromEntries(
    Object.entries<number | null>(record).map(([key, value]) => [
      key,
      round(value),
    ]),
  );

const promptChars = (prompt: ReturnType<typeof groundedPrompt>) =>
  prompt.reduce(
    (total, message) =>
      total +
      (typeof message.content === "string"
        ? message.content.length
        : JSON.stringify(message.content).length),
    0,
  );

const dollars = (inputTokens: number, outputTokens: number) =>
  (inputTokens * haikuDollarsPerMillion.input +
    outputTokens * haikuDollarsPerMillion.output) /
  1e6;

interface Collected {
  readonly passages: ReadonlyArray<RetrievedPassage>;
  readonly answer: string;
  readonly failed: boolean;
  readonly model: string | null;
}

const collect = (events: ReadonlyArray<ChatEvent>): Collected => ({
  passages: events.flatMap((event) =>
    event._tag === "Citations" ? event.passages : [],
  ),
  answer: events
    .flatMap((event) => (event._tag === "Delta" ? [event.text] : []))
    .join(""),
  failed: events.some((event) => event._tag === "Failed"),
  model: events.findLast((event) => event._tag === "Done")?.model ?? null,
});

interface Outcome {
  readonly question: EvalQuestion;
  readonly collected: Collected;
  readonly scored: ScoredAnswer;
  readonly judged: FaithfulnessScore | null;
}

const judgeSummary = (outcomes: ReadonlyArray<Outcome>) => {
  const judged = outcomes.flatMap((outcome) =>
    outcome.judged === null || outcome.judged.claims === 0
      ? []
      : [outcome.judged],
  );
  const claims = judged.reduce((total, score) => total + score.claims, 0);
  const sum = (pick: (score: FaithfulnessScore) => number) =>
    judged.reduce((total, score) => total + pick(score), 0);
  return {
    judgedAnswers: judged.length,
    judgeFaithfulness:
      judged.length === 0
        ? null
        : mean(judged.map((score) => score.faithfulness ?? 0)),
    judgeSupportedElsewhere:
      claims === 0 ? null : sum((s) => s.supportedByOtherPassage) / claims,
    judgeUnsupported:
      claims === 0 ? null : sum((s) => s.unsupported + s.contradicted) / claims,
    judgeUnverifiedQuotes:
      claims === 0 ? null : sum((s) => s.unverifiedQuotes) / claims,
  };
};

const summarize = (outcomes: ReadonlyArray<Outcome>, withJudge: boolean) => {
  const summary: AnswerSummary = summarizeAnswers(
    outcomes.map(({ question, scored }) => ({
      answerable: question.answerable,
      ...scored,
    })),
  );
  return roundAll(
    withJudge ? { ...summary, ...judgeSummary(outcomes) } : summary,
  );
};

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const store = yield* CorpusStore;
  const retriever = yield* Retriever;
  const { provider, judge, model, limit } = yield* settings;
  const check = process.argv.includes("--check");
  const estimateOnly = process.argv.includes("--estimate");
  const paid = provider !== "mock" || judge !== "none";

  const allQuestions = (yield* loadEvalSets).flatMap((set) => set.questions);
  if (paid && !estimateOnly && Option.isNone(limit)) {
    return yield* new SpendNotCapped({
      message: `EVAL_PROVIDER=${provider} EVAL_JUDGE=${judge} calls ${model}. Set EVAL_LIMIT (1-${allQuestions.length}) to cap the run.`,
    });
  }
  const questions = Option.match(limit, {
    onNone: () => allQuestions,
    onSome: (count) => evenlySpaced(allQuestions, count),
  });

  if (paid || estimateOnly) {
    const prompts = yield* Effect.forEach(questions, (question) =>
      Effect.map(
        retriever.search({
          query: question.question,
          scope: {},
          limit: passagesPerAnswer,
        }),
        (passages) =>
          groundedPrompt(
            [{ role: "user", content: question.question }],
            passages,
          ),
      ),
    );
    const answerInput = Math.ceil(
      prompts.reduce((total, prompt) => total + promptChars(prompt), 0) /
        charsPerToken,
    );
    const calls = questions.length;
    const answerCost =
      provider === "mock" ? 0 : dollars(answerInput, calls * answerMaxTokens);
    const judgeInput =
      answerInput +
      Math.ceil(
        (judgePrompt({ question: "", answer: "", passages: [] })[0]?.content
          .length ?? 0) / charsPerToken,
      ) *
        calls +
      calls * answerMaxTokens;
    const judgeCost =
      judge === "none" ? 0 : dollars(judgeInput, calls * judgeMaxTokens);
    console.table({
      answers: {
        model: provider === "mock" ? "mock-extractive" : model,
        calls,
        inputTokens: answerInput,
        maxOutputTokens: calls * answerMaxTokens,
        maxDollars: Number(answerCost.toFixed(4)),
      },
      judge: {
        model: judge === "none" ? "off" : model,
        calls: judge === "none" ? 0 : calls,
        inputTokens: judge === "none" ? 0 : judgeInput,
        maxOutputTokens: judge === "none" ? 0 : calls * judgeMaxTokens,
        maxDollars: Number(judgeCost.toFixed(4)),
      },
    });
    console.log(
      `Ceiling: $${(answerCost + judgeCost).toFixed(4)} at Haiku 5.5 list prices, assuming ${charsPerToken} characters per token and every reply hitting max_tokens.`,
    );
  }
  if (estimateOnly) return;

  const goldQids = [
    ...new Set(questions.flatMap((q) => q.gold.map((g) => g.qid))),
  ];
  const passagesByGame = Map.groupBy(
    yield* store.passagesOf(goldQids),
    (p) => p.gameQid,
  );

  const plan: ChatPlan =
    provider === "mock"
      ? ExecutionPlan.make({
          provide: MockProvider.extractive({ tokenDelay: Duration.zero }),
        })
      : ExecutionPlan.make({ provide: anthropic(model), attempts: 2 });
  const judgeModel = anthropic(model, { max_tokens: judgeMaxTokens });

  const answerOne = (question: EvalQuestion) =>
    Effect.gen(function* () {
      const chat = yield* GroundedChat;
      const collected = collect(
        yield* Stream.runCollect(
          chat.stream({
            messages: [{ role: "user", content: question.question }],
            scope: {},
          }),
        ),
      );
      const scored = scoreAnswer({
        answerable: question.answerable,
        answers: question.answers,
        goldGameQids: new Set(question.gold.map((gold) => gold.qid)),
        goldPassageIds: resolveGold(question, passagesByGame).goldPassageIds,
        passages: collected.passages,
        answer: collected.answer,
        failed: collected.failed,
      });
      const judged =
        judge === "none" || scored.abstained || scored.failed
          ? null
          : yield* judgeFaithfulness({
              question: question.question,
              answer: collected.answer,
              passages: collected.passages,
            }).pipe(
              Effect.provide(judgeModel),
              Effect.catch(() => Effect.succeed(null)),
            );
      return { question, collected, scored, judged };
    });

  const outcomes = yield* Effect.forEach(questions, answerOne, {
    concurrency: provider === "mock" ? 1 : 4,
  }).pipe(
    Effect.provide(
      GroundedChat.layer(plan, yield* firstTokenDeadline).pipe(
        Layer.provide(CircuitBreaker.layer),
      ),
    ),
  );

  const withJudge = judge !== "none";
  const results: GroupResults = Object.fromEntries(
    [...groupsOf(outcomes, (outcome) => outcome.question)].map(
      ([key, group]) => [key, summarize(group, withJudge)],
    ),
  );

  console.table(
    Object.entries(results).map(([group, values]) => ({
      group,
      n: values["questions"],
      contains: values["answerContainment"],
      f1: values["answerF1"],
      citeValid: values["citationValidity"],
      citePrec: values["citationPrecision"],
      citeRecall: values["citationRecall"],
      uncited: values["uncitedSentenceRate"],
      faithful: values["faithfulness"],
      abstainOk: values["correctAbstention"],
      abstainBad: values["falseAbstention"],
    })),
  );

  const answeredBy = provider === "mock" ? "mock-extractive" : model;
  const base = `${evalDirectory}results/answers${
    provider === "mock" ? "" : `.${model}`
  }${Option.match(limit, { onNone: () => "", onSome: (n) => `.sample${n}` })}`;

  if (check) {
    const committed = yield* Schema.decodeUnknownEffect(CommittedResults)(
      yield* fs.readFileString(`${base}.json`),
    );
    const found = regressions(committed.results, results, gate);
    if (found.length > 0) {
      console.table(found);
      return yield* new AnswerRegression({
        message: found
          .map((r) => `${r.group} ${r.metric}: ${r.baseline} -> ${r.fresh}`)
          .join("; "),
      });
    }
    console.log(
      `No answer metric dropped by more than ${gate.tolerance} in any group of ${gate.minimumQuestions}+ questions.`,
    );
    return;
  }

  const stats = yield* store.stats;
  yield* fs.makeDirectory(`${evalDirectory}results`, { recursive: true });
  yield* fs.writeFileString(
    `${base}.json`,
    `${JSON.stringify(
      {
        corpus: stats,
        answeredBy,
        judgedBy: withJudge ? model : null,
        passagesPerAnswer,
        gate: {
          tolerance: gate.tolerance,
          minimumQuestions: gate.minimumQuestions,
        },
        results,
      },
      null,
      2,
    )}\n`,
  );
  yield* fs.writeFileString(
    `${base}.questions.jsonl`,
    outcomes
      .map(({ question, collected, scored, judged }) =>
        JSON.stringify({
          id: question.id,
          answerable: question.answerable,
          answeredBy: collected.model,
          answer: collected.answer,
          sent: collected.passages.map((passage) => passage.id),
          scores: roundAll({
            abstained: Number(scored.abstained),
            failed: Number(scored.failed),
            goldPassageSent:
              scored.goldPassageSent === null
                ? null
                : Number(scored.goldPassageSent),
            answerContainment: scored.answerContainment,
            answerF1: scored.answerF1,
            citationValidity: scored.citationValidity,
            citationPrecision: scored.citationPrecision,
            citationRecall: scored.citationRecall,
            uncitedSentenceRate: scored.uncitedSentenceRate,
            faithfulness: scored.faithfulness,
          }),
          ...(withJudge ? { judge: judged } : {}),
        }),
      )
      .map((line) => `${line}\n`)
      .join(""),
  );
});

BunRuntime.runMain(
  program.pipe(
    Effect.provide(
      Retriever.layer.pipe(
        Layer.provideMerge(
          Layer.provideMerge(CorpusDatabase, BunServices.layer),
        ),
      ),
    ),
  ),
);

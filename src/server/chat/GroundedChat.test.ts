import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, ExecutionPlan, Layer, Stream } from "effect";
import { AiError, LanguageModel, Model } from "effect/ai";
import {
  corpusFixture,
  japan,
  sovietUnion,
} from "@/server/corpus/CorpusFixture";
import { MockProvider } from "@/server/provider/MockProvider";
import { notCovered } from "@/server/provider/ExtractiveAnswer";
import { Retriever } from "@/server/search/Retriever";
import type { ChatEvent, ChatRequest } from "./ChatProtocol";
import { type ChatPlan, GroundedChat, providerFailed } from "./GroundedChat";

const fixture = corpusFixture([
  {
    qid: "Q1",
    title: "Tetris",
    released: "1985",
    origins: [sovietUnion],
    passages: [
      {
        heading: "Tetris",
        text: "Tetris is a puzzle video game. It was created by Alexey Pajitnov in 1985.",
      },
    ],
  },
  {
    qid: "Q2",
    title: "Puyo Puyo",
    released: "1991-10-25",
    origins: [japan],
    passages: [
      {
        heading: "Puyo Puyo",
        text: "Puyo Puyo is a falling block puzzle game developed by Compile.",
      },
    ],
  },
]);

const outage = AiError.make({
  module: "TestProvider",
  method: "streamText",
  reason: new AiError.InternalProviderError({
    description: "simulated outage",
  }),
});

const partialThenOutage = Model.make(
  "test",
  "partial-then-outage",
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: () => Effect.fail(outage),
      streamText: () =>
        Stream.make(
          { type: "text-start" as const, id: "t" },
          { type: "text-delta" as const, id: "t", delta: "Partial " },
        ).pipe(Stream.concat(Stream.fail(outage))),
    }),
  ),
);

const extractive = MockProvider.extractive({ tokenDelay: Duration.zero });

const chatWith = (plan: ChatPlan) =>
  GroundedChat.layer(plan).pipe(
    Layer.provide(Retriever.layer),
    Layer.provide(fixture),
  );

const ask = (content: string, scope: ChatRequest["scope"] = {}) =>
  Effect.flatMap(GroundedChat, (chat) =>
    Stream.runCollect(
      chat.stream({ messages: [{ role: "user", content }], scope }),
    ),
  );

const answerText = (events: ReadonlyArray<ChatEvent>) =>
  events
    .flatMap((event) => (event._tag === "Delta" ? [event.text] : []))
    .join("");

const tags = (events: ReadonlyArray<ChatEvent>) =>
  events.map((event) => event._tag);

describe("GroundedChat.stream", () => {
  it.effect(
    "sends citations first, then the cited answer, then the model that answered",
    () =>
      Effect.gen(function* () {
        const events = yield* ask("Who created Tetris?");
        const [first] = events;
        assert.strictEqual(first?._tag, "Citations");
        assert.strictEqual(
          first?._tag === "Citations" ? first.passages[0]?.gameQid : undefined,
          "Q1",
        );
        assert.include(
          answerText(events),
          "created by Alexey Pajitnov in 1985. [1]",
        );
        assert.deepStrictEqual(events.at(-1), {
          _tag: "Done",
          model: "mock-extractive",
        });
      }).pipe(
        Effect.provide(chatWith(ExecutionPlan.make({ provide: extractive }))),
      ),
  );

  it.effect(
    "fails over to the next provider when the first fails before any token",
    () =>
      Effect.gen(function* () {
        const events = yield* ask("Who created Tetris?");
        assert.notInclude(tags(events), "Failed");
        assert.deepStrictEqual(events.at(-1), {
          _tag: "Done",
          model: "mock-extractive",
        });
      }).pipe(
        Effect.provide(
          chatWith(
            ExecutionPlan.make(
              { provide: MockProvider.failing },
              { provide: extractive },
            ),
          ),
        ),
      ),
  );

  it.effect(
    "reports a failure instead of restarting the answer once tokens have streamed",
    () =>
      Effect.gen(function* () {
        const events = yield* ask("Who created Tetris?");
        assert.deepStrictEqual(tags(events), [
          "Citations",
          "Delta",
          "Failed",
          "Done",
        ]);
        assert.strictEqual(answerText(events), "Partial ");
        assert.deepStrictEqual(events.at(-1), {
          _tag: "Done",
          model: "partial-then-outage",
        });
      }).pipe(
        Effect.provide(
          chatWith(
            ExecutionPlan.make(
              { provide: partialThenOutage },
              { provide: extractive },
            ),
          ),
        ),
      ),
  );

  it.effect(
    "says the articles don't cover it, without calling a provider, when nothing in scope matches",
    () =>
      Effect.gen(function* () {
        const events = yield* ask("Who created Tetris?", { region: "Oceania" });
        assert.deepStrictEqual(events, [
          { _tag: "Citations", passages: [] },
          { _tag: "Delta", text: notCovered },
          { _tag: "Done", model: null },
        ]);
      }).pipe(
        Effect.provide(
          chatWith(ExecutionPlan.make({ provide: MockProvider.failing })),
        ),
      ),
  );

  it.effect(
    "keeps the user's question and the provider error out of the failure it reports",
    () =>
      Effect.gen(function* () {
        const question = "which puzzle game helps with my anxiety medication";
        const events = yield* ask(question);
        const failure = events.find((event) => event._tag === "Failed");
        assert.deepStrictEqual(failure, {
          _tag: "Failed",
          message: providerFailed,
        });
        const afterCitations = JSON.stringify(events.slice(1));
        assert.notInclude(afterCitations, question);
        assert.notInclude(afterCitations, "simulated outage");
      }).pipe(
        Effect.provide(
          chatWith(ExecutionPlan.make({ provide: MockProvider.failing })),
        ),
      ),
  );
});

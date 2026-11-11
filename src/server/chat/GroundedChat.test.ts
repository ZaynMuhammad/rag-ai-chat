import { assert, describe, it } from "@effect/vitest";
import {
  type Array as Arr,
  Duration,
  Effect,
  Fiber,
  Layer,
  Ref,
  Stream,
} from "effect";
import { AiError, LanguageModel, Model, type Response } from "effect/ai";
import { TestClock } from "effect/testing";
import {
  corpusFixture,
  japan,
  sovietUnion,
} from "@/server/corpus/CorpusFixture";
import {
  CircuitBreaker,
  defaultBreakerPolicy,
} from "@/server/provider/CircuitBreaker";
import { MockProvider } from "@/server/provider/MockProvider";
import { notCovered } from "@/server/provider/ExtractiveAnswer";
import { Retriever } from "@/server/search/Retriever";
import type { ChatEvent, ChatRequest } from "./ChatProtocol";
import {
  type ChatProvider,
  GroundedChat,
  providerFailed,
  UnknownModel,
} from "./GroundedChat";

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

const testModel = (
  id: string,
  streamText: () => Stream.Stream<Response.StreamPartEncoded, AiError.AiError>,
): ChatProvider => ({
  id,
  provider: "test",
  model: Model.make(
    "test",
    id,
    Layer.effect(
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText: () => Effect.fail(outage),
        streamText,
      }),
    ),
  ),
});

const textStart = { type: "text-start" as const, id: "t" };
const delta = (text: string) => ({
  type: "text-delta" as const,
  id: "t",
  delta: text,
});

const partialThenOutage = testModel("partial-then-outage", () =>
  Stream.make(textStart, delta("Partial ")).pipe(
    Stream.concat(Stream.fail(outage)),
  ),
);

const extractive: ChatProvider = {
  id: "mock-extractive",
  provider: "mock",
  model: MockProvider.extractive({ tokenDelay: Duration.zero }),
};

const failing: ChatProvider = {
  id: "mock-failing",
  provider: "mock",
  model: MockProvider.failing,
};

const deadline = Duration.seconds(2);

const chatWith = (...providers: Arr.NonEmptyReadonlyArray<ChatProvider>) =>
  GroundedChat.layer(providers, deadline).pipe(
    Layer.provide(CircuitBreaker.layer),
    Layer.provide(Retriever.layer),
    Layer.provide(fixture),
  );

const countedPrimary = Effect.gen(function* () {
  const calls = yield* Ref.make(0);
  const healthy = yield* Ref.make(false);
  const provider = testModel("primary", () =>
    Stream.unwrap(
      Effect.gen(function* () {
        yield* Ref.update(calls, (n) => n + 1);
        return (yield* Ref.get(healthy))
          ? Stream.make(textStart, delta("The primary is back."))
          : Stream.fail(outage);
      }),
    ),
  );
  return { calls, healthy, provider };
});

const askInBackground = (content: string) =>
  ask(content).pipe(Effect.forkChild({ startImmediately: true }));

const ask = (
  content: string,
  scope: ChatRequest["scope"] = {},
  model?: string,
) =>
  Effect.flatMap(GroundedChat, (chat) =>
    Effect.flatMap(
      chat.stream({
        messages: [{ role: "user", content }],
        scope,
        ...(model === undefined ? {} : { model }),
      }),
      Stream.runCollect,
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
      }).pipe(Effect.provide(chatWith(extractive))),
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
      }).pipe(Effect.provide(chatWith(failing, extractive))),
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
      }).pipe(Effect.provide(chatWith(partialThenOutage, extractive))),
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
      }).pipe(Effect.provide(chatWith(failing))),
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
      }).pipe(Effect.provide(chatWith(failing))),
  );

  it.effect(
    "fails over when the first provider has not sent a token by the deadline",
    () =>
      Effect.gen(function* () {
        const fiber = yield* askInBackground("Who created Tetris?");
        yield* TestClock.adjust(deadline);
        const events = yield* Fiber.join(fiber);
        assert.notInclude(tags(events), "Failed");
        assert.include(answerText(events), "Alexey Pajitnov");
        assert.deepStrictEqual(events.at(-1), {
          _tag: "Done",
          model: "mock-extractive",
        });
      }).pipe(
        Effect.provide(
          chatWith(
            testModel("hangs", () => Stream.never),
            extractive,
          ),
        ),
      ),
  );

  it.effect("keeps a slow answer once its first token has arrived", () =>
    Effect.gen(function* () {
      const fiber = yield* askInBackground("Who created Tetris?");
      yield* TestClock.adjust("10 seconds");
      const events = yield* Fiber.join(fiber);
      assert.strictEqual(answerText(events), "Slow but sure.");
      assert.deepStrictEqual(events.at(-1), { _tag: "Done", model: "slow" });
    }).pipe(
      Effect.provide(
        chatWith(
          testModel("slow", () =>
            Stream.make(textStart, delta("Slow ")).pipe(
              Stream.concat(
                Stream.fromEffect(
                  Effect.as(Effect.sleep("5 seconds"), delta("but sure.")),
                ),
              ),
            ),
          ),
          extractive,
        ),
      ),
    ),
  );

  it.effect("never cuts off the last provider in the plan", () =>
    Effect.gen(function* () {
      const fiber = yield* askInBackground("Who created Tetris?");
      yield* TestClock.adjust("5 seconds");
      const events = yield* Fiber.join(fiber);
      assert.deepStrictEqual(tags(events), ["Citations", "Delta", "Done"]);
    }).pipe(
      Effect.provide(
        chatWith(
          testModel("last-resort", () =>
            Stream.fromEffect(
              Effect.as(Effect.sleep("5 seconds"), delta("Late.")),
            ),
          ),
        ),
      ),
    ),
  );

  it.effect(
    "skips a provider whose circuit is open without calling it, then returns once it recovers",
    () =>
      Effect.gen(function* () {
        const primary = yield* countedPrimary;
        yield* Effect.gen(function* () {
          for (let i = 0; i < defaultBreakerPolicy.consecutiveFailures; i++) {
            yield* ask("Who created Tetris?");
          }
          const whileOpen = yield* ask("Who created Tetris?");
          assert.strictEqual(
            yield* Ref.get(primary.calls),
            defaultBreakerPolicy.consecutiveFailures,
          );
          assert.deepStrictEqual(whileOpen.at(-1), {
            _tag: "Done",
            model: "mock-extractive",
          });

          yield* Ref.set(primary.healthy, true);
          yield* TestClock.adjust(defaultBreakerPolicy.cooldown);
          const probe = yield* ask("Who created Tetris?");
          assert.deepStrictEqual(probe.at(-1), {
            _tag: "Done",
            model: "primary",
          });
          const afterProbe = yield* ask("Who created Tetris?");
          assert.strictEqual(answerText(afterProbe), "The primary is back.");
        }).pipe(Effect.provide(chatWith(primary.provider, extractive)));
      }),
  );

  it.effect(
    "puts the chosen model first and keeps the rest in order as fallback",
    () =>
      Effect.gen(function* () {
        const chosen = yield* ask("Who created Tetris?", {}, "mock-extractive");
        assert.deepStrictEqual(chosen.at(-1), {
          _tag: "Done",
          model: "mock-extractive",
        });
        const fellBack = yield* ask("Who created Tetris?", {}, "mock-failing");
        assert.deepStrictEqual(fellBack.at(-1), {
          _tag: "Done",
          model: "default",
        });
      }).pipe(
        Effect.provide(
          chatWith(
            testModel("default", () =>
              Stream.make(textStart, delta("From the default.")),
            ),
            failing,
            extractive,
          ),
        ),
      ),
  );

  it.effect(
    "lists the configured models and rejects one that is not configured",
    () =>
      Effect.gen(function* () {
        const chat = yield* GroundedChat;
        assert.deepStrictEqual(chat.models, [
          { id: "mock-failing", provider: "mock" },
          { id: "mock-extractive", provider: "mock" },
        ]);
        const rejected = yield* Effect.flip(
          chat.stream({
            messages: [{ role: "user", content: "Who created Tetris?" }],
            scope: {},
            model: "gpt-9",
          }),
        );
        assert.instanceOf(rejected, UnknownModel);
      }).pipe(Effect.provide(chatWith(failing, extractive))),
  );
});

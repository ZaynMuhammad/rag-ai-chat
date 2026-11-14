import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Metric,
  Option,
  Queue,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { corpusFixture, sovietUnion } from "@/server/corpus/CorpusFixture";
import { CircuitBreaker } from "@/server/provider/CircuitBreaker";
import { MockProvider } from "@/server/provider/MockProvider";
import { Retriever } from "@/server/search/Retriever";
import {
  type AnswerCacheOptions,
  type AnswerKeyParts,
  answerKey,
  answerCacheLayer,
  normalizeQuestion,
} from "./AnswerCache";
import type { ChatEvent, ChatRequest } from "./ChatProtocol";
import { GroundedChat } from "./GroundedChat";

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
]);

const keyParts: AnswerKeyParts = {
  secret: new Uint8Array(32),
  corpusVersion: "passages:1;revisions:1000",
  models: ["mock-extractive", "mock-fallback"],
};

const question = (
  content: string,
  scope: ChatRequest["scope"] = {},
): ChatRequest => ({ messages: [{ role: "user", content }], scope });

const keyOf = (
  request: ChatRequest,
  parts: AnswerKeyParts = keyParts,
  model = "mock-extractive",
) => Option.getOrThrow(answerKey(parts, model, request));

const followUp: ChatRequest = {
  messages: [
    { role: "user", content: "Who created Tetris?" },
    { role: "assistant", content: "Alexey Pajitnov." },
    { role: "user", content: "When?" },
  ],
  scope: {},
};

const answer: ReadonlyArray<ChatEvent> = [
  { _tag: "Citations", passages: [] },
  { _tag: "Delta", text: "Alexey " },
  { _tag: "Delta", text: "Pajitnov. [1]" },
  { _tag: "Done", model: "mock-extractive" },
];

const failedAnswer: ReadonlyArray<ChatEvent> = [
  { _tag: "Citations", passages: [] },
  { _tag: "Delta", text: "Partial " },
  { _tag: "Failed", message: "Every model provider failed." },
  { _tag: "Done", model: "mock-extractive" },
];

const fallbackAnswer: ReadonlyArray<ChatEvent> = [
  { _tag: "Citations", passages: [] },
  { _tag: "Delta", text: "Alexey Pajitnov. [1]" },
  { _tag: "Done", model: "mock-fallback" },
];

type Feed = Queue.Queue<ChatEvent, Cause.Done>;

const options: AnswerCacheOptions = {
  capacity: 10,
  timeToLive: "10 minutes",
};

const withCache = <A, E>(
  program: (
    upstreamCalls: Queue.Queue<Feed>,
  ) => Effect.Effect<A, E, GroundedChat>,
  cacheOptions: AnswerCacheOptions = options,
) =>
  Effect.gen(function* () {
    const upstreamCalls = yield* Queue.unbounded<Feed>();
    const scriptedUpstream = Layer.succeed(
      GroundedChat,
      GroundedChat.of({
        models: [
          { id: "mock-extractive", provider: "mock" },
          { id: "mock-fallback", provider: "mock" },
        ],
        stream: () =>
          Effect.succeed(
            Stream.unwrap(
              Effect.gen(function* () {
                const feed = yield* Queue.unbounded<ChatEvent, Cause.Done>();
                yield* Queue.offer(upstreamCalls, feed);
                return Stream.fromQueue(feed);
              }),
            ),
          ),
      }),
    );
    return yield* program(upstreamCalls).pipe(
      Effect.provide(
        answerCacheLayer(cacheOptions).pipe(
          Layer.provide(scriptedUpstream),
          Layer.provide(fixture),
        ),
      ),
    );
  }).pipe(Effect.provideService(Metric.MetricRegistry, new Map()));

const ask = (request: ChatRequest) =>
  Effect.flatMap(GroundedChat, (chat) =>
    Effect.flatMap(chat.stream(request), Stream.runCollect),
  );

const askInBackground = (request: ChatRequest) =>
  Effect.gen(function* () {
    const seen = yield* Queue.unbounded<ChatEvent>();
    const chat = yield* GroundedChat;
    const fiber = yield* (yield* chat.stream(request)).pipe(
      Stream.runForEach((event) => Queue.offer(seen, event)),
      Effect.forkChild,
    );
    return { seen, fiber };
  });

const realChat = GroundedChat.layer(
  [
    {
      id: "mock-extractive",
      provider: "mock",
      model: MockProvider.extractive({ tokenDelay: Duration.zero }),
    },
  ],
  Duration.seconds(2),
).pipe(Layer.provide(CircuitBreaker.layer));

const cutOffChat = GroundedChat.layer(
  [
    {
      id: "mock-extractive",
      provider: "mock",
      model: MockProvider.model({
        reply: "It was created at the Soviet Academy of Sciences [1]. The S",
        tokenDelay: "10 millis",
        finishReason: "length",
      }),
    },
  ],
  Duration.seconds(2),
).pipe(Layer.provide(CircuitBreaker.layer));

const answerFrom = (feed: Feed, events: ReadonlyArray<ChatEvent>) =>
  Effect.andThen(Queue.offerAll(feed, events), Queue.end(feed));

const pendingCalls = (upstreamCalls: Queue.Queue<Feed>) =>
  Queue.size(upstreamCalls);

const cacheResults = Effect.map(Metric.snapshot, (snapshots) => {
  const counts: Record<string, number> = {};
  for (const snapshot of snapshots) {
    if (
      snapshot.id === "answer_cache_requests_total" &&
      snapshot.type === "Counter"
    ) {
      counts[String(snapshot.attributes?.["result"])] = Number(
        snapshot.state.count,
      );
    }
  }
  return counts;
});

describe("normalizeQuestion", () => {
  it("folds case, width, spacing, and edge punctuation", () => {
    const variants = [
      "Who created Tetris?",
      "  who CREATED   tetris  ??",
      "Who created Ｔｅｔｒｉｓ",
      "who created tetris",
      "Who\tcreated\nTetris!",
    ];
    assert.deepStrictEqual(new Set(variants.map(normalizeQuestion)).size, 1);
  });

  it("keeps words and symbols that change the meaning", () => {
    const pairs = [
      ["games by Nintendo", "games not by Nintendo"],
      ["games written in C++", "games written in C"],
      ["Doom 2", "Doom"],
      ["Doom 2", "Doom 3"],
      ["Who made Tetris", "Who made Tetris 2"],
      ["games before 1990", "games after 1990"],
    ] as const;
    for (const [a, b] of pairs) {
      assert.notStrictEqual(normalizeQuestion(a), normalizeQuestion(b));
    }
  });
});

describe("answerKey", () => {
  it("separates meanings, scopes, models, and corpus versions", () => {
    const base = question("games by Nintendo", { region: "Asia" });
    const keys = [
      keyOf(base),
      keyOf(question("games not by Nintendo", { region: "Asia" })),
      keyOf(question("games by Nintendo", { region: "Europe" })),
      keyOf(question("games by Nintendo", { region: "Asia", from: 1990 })),
      keyOf(question("games by Nintendo")),
      keyOf(base, keyParts, "mock-fallback"),
      keyOf(base, {
        ...keyParts,
        models: ["claude-haiku-5-5", "mock-extractive"],
      }),
      keyOf(base, { ...keyParts, corpusVersion: "passages:2;revisions:1000" }),
    ];
    assert.strictEqual(new Set(keys).size, keys.length);
  });

  it("does not depend on the order of scope fields", () => {
    assert.strictEqual(
      keyOf(question("puzzle games", { region: "Europe", from: 1980 })),
      keyOf(question("puzzle games", { from: 1980, region: "Europe" })),
    );
  });

  it("is a keyed hash that holds none of the question", () => {
    const key = keyOf(question("which puzzle game helps with my anxiety"));
    assert.match(key, /^[A-Za-z0-9_-]{43}$/);
    assert.notInclude(key.toLowerCase(), "anxiety");
    assert.notStrictEqual(
      key,
      keyOf(question("which puzzle game helps with my anxiety"), {
        ...keyParts,
        secret: new Uint8Array(32).fill(1),
      }),
    );
  });

  it("leaves follow-up turns uncached", () => {
    assert.isTrue(
      Option.isNone(answerKey(keyParts, "mock-extractive", followUp)),
    );
  });
});

describe("answerCacheLayer", () => {
  it.effect("serves a repeated question from the cache", () =>
    withCache((upstreamCalls) =>
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(
          ask(question("Who made Tetris?")),
        );
        yield* answerFrom(yield* Queue.take(upstreamCalls), answer);
        assert.deepStrictEqual(yield* Fiber.join(first), answer);

        const second = yield* ask(question("who made tetris"));
        assert.deepStrictEqual(second, answer);
        assert.strictEqual(yield* pendingCalls(upstreamCalls), 0);
        assert.deepStrictEqual(yield* cacheResults, { miss: 1, hit: 1 });
      }),
    ),
  );

  it.effect("does not cache an answer that reported a provider failure", () =>
    withCache((upstreamCalls) =>
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(
          ask(question("Who made Tetris?")),
        );
        yield* answerFrom(yield* Queue.take(upstreamCalls), failedAnswer);
        assert.deepStrictEqual(yield* Fiber.join(first), failedAnswer);

        const retry = yield* Effect.forkChild(
          ask(question("Who made Tetris?")),
        );
        yield* answerFrom(yield* Queue.take(upstreamCalls), answer);
        assert.deepStrictEqual(yield* Fiber.join(retry), answer);
        assert.deepStrictEqual(yield* cacheResults, { miss: 2 });
      }),
    ),
  );

  it.effect(
    "does not cache an answer a fallback model wrote while the primary was down",
    () =>
      withCache((upstreamCalls) =>
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(
            ask(question("Who made Tetris?")),
          );
          yield* answerFrom(yield* Queue.take(upstreamCalls), fallbackAnswer);
          assert.deepStrictEqual(yield* Fiber.join(first), fallbackAnswer);

          const recovered = yield* Effect.forkChild(
            ask(question("Who made Tetris?")),
          );
          yield* answerFrom(yield* Queue.take(upstreamCalls), answer);
          assert.deepStrictEqual(yield* Fiber.join(recovered), answer);
          assert.deepStrictEqual(
            yield* ask(question("Who made Tetris?")),
            answer,
          );
          assert.deepStrictEqual(yield* cacheResults, { miss: 2, hit: 1 });
        }),
      ),
  );

  it.effect("keeps answers apart when a chat picks another model", () =>
    withCache((upstreamCalls) =>
      Effect.gen(function* () {
        const picked = {
          ...question("Who made Tetris?"),
          model: "mock-fallback",
        };
        const first = yield* Effect.forkChild(ask(picked));
        yield* answerFrom(yield* Queue.take(upstreamCalls), fallbackAnswer);
        assert.deepStrictEqual(yield* Fiber.join(first), fallbackAnswer);

        const byDefault = yield* Effect.forkChild(
          ask(question("Who made Tetris?")),
        );
        yield* answerFrom(yield* Queue.take(upstreamCalls), answer);
        assert.deepStrictEqual(yield* Fiber.join(byDefault), answer);

        assert.deepStrictEqual(yield* ask(picked), fallbackAnswer);
        assert.deepStrictEqual(yield* cacheResults, { miss: 2, hit: 1 });
      }),
    ),
  );

  it.effect("does not cache a stream that broke partway", () =>
    withCache((upstreamCalls) =>
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(
          Effect.exit(ask(question("Who made Tetris?"))),
        );
        const feed = yield* Queue.take(upstreamCalls);
        yield* Queue.offerAll(feed, answer.slice(0, 2));
        yield* Queue.failCause(feed, Cause.die("connection reset"));
        assert.isTrue(Exit.hasDies(yield* Fiber.join(first)));

        const retry = yield* Effect.forkChild(
          ask(question("Who made Tetris?")),
        );
        yield* answerFrom(yield* Queue.take(upstreamCalls), answer);
        assert.deepStrictEqual(yield* Fiber.join(retry), answer);
      }),
    ),
  );

  it.effect(
    "asks upstream again once an answer outlives its time to live",
    () =>
      withCache((upstreamCalls) =>
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(
            ask(question("Who made Tetris?")),
          );
          yield* answerFrom(yield* Queue.take(upstreamCalls), answer);
          yield* Fiber.join(first);

          yield* TestClock.adjust("9 minutes");
          yield* ask(question("Who made Tetris?"));
          assert.strictEqual(yield* pendingCalls(upstreamCalls), 0);

          yield* TestClock.adjust("2 minutes");
          const expired = yield* Effect.forkChild(
            ask(question("Who made Tetris?")),
          );
          yield* answerFrom(yield* Queue.take(upstreamCalls), answer);
          assert.deepStrictEqual(yield* Fiber.join(expired), answer);
        }),
      ),
  );

  it.effect("evicts the least recently used answer when full", () =>
    withCache(
      (upstreamCalls) =>
        Effect.gen(function* () {
          const fresh = (content: string) =>
            Effect.gen(function* () {
              const fiber = yield* Effect.forkChild(ask(question(content)));
              yield* answerFrom(yield* Queue.take(upstreamCalls), answer);
              yield* Fiber.join(fiber);
            });
          yield* fresh("Tetris");
          yield* fresh("Doom");
          yield* ask(question("Tetris"));
          yield* fresh("Myst");
          yield* ask(question("Tetris"));
          yield* fresh("Doom");
          assert.deepStrictEqual(yield* cacheResults, { miss: 4, hit: 2 });
        }),
      { ...options, capacity: 2 },
    ),
  );

  it.effect(
    "shares one upstream stream: a late joiner gets what was sent, then the live tail",
    () =>
      withCache((upstreamCalls) =>
        Effect.gen(function* () {
          const leader = yield* askInBackground(question("Who made Tetris?"));
          const feed = yield* Queue.take(upstreamCalls);
          yield* Queue.offerAll(feed, answer.slice(0, 2));
          assert.deepStrictEqual(
            yield* Queue.takeN(leader.seen, 2),
            answer.slice(0, 2),
          );

          const joiner = yield* askInBackground(question("who made tetris"));
          assert.deepStrictEqual(
            yield* Queue.takeN(joiner.seen, 2),
            answer.slice(0, 2),
          );

          yield* answerFrom(feed, answer.slice(2));
          yield* Fiber.join(leader.fiber);
          yield* Fiber.join(joiner.fiber);
          assert.deepStrictEqual(
            yield* Queue.takeAll(joiner.seen),
            answer.slice(2),
          );
          assert.strictEqual(yield* pendingCalls(upstreamCalls), 0);
          assert.deepStrictEqual(yield* cacheResults, {
            miss: 1,
            coalesced: 1,
          });
        }),
      ),
  );

  it.effect(
    "finishes the shared stream for others, and caches it, when the leader disconnects",
    () =>
      withCache((upstreamCalls) =>
        Effect.gen(function* () {
          const leader = yield* askInBackground(question("Who made Tetris?"));
          const feed = yield* Queue.take(upstreamCalls);
          yield* Queue.offerAll(feed, answer.slice(0, 2));
          yield* Queue.takeN(leader.seen, 2);
          const joiner = yield* askInBackground(question("Who made Tetris?"));
          yield* Queue.takeN(joiner.seen, 2);

          yield* Fiber.interrupt(leader.fiber);
          yield* answerFrom(feed, answer.slice(2));
          yield* Fiber.join(joiner.fiber);
          assert.deepStrictEqual(
            yield* Queue.takeAll(joiner.seen),
            answer.slice(2),
          );

          assert.deepStrictEqual(
            yield* ask(question("Who made Tetris?")),
            answer,
          );
          assert.strictEqual(yield* pendingCalls(upstreamCalls), 0);
        }),
      ),
  );

  it.effect(
    "does not keep an answer the provider cut off, nor hand it to a late joiner as complete",
    () =>
      Effect.gen(function* () {
        const leader = yield* askInBackground(question("Who made Tetris?"));
        yield* TestClock.adjust("10 millis");
        const firstDelta = yield* Queue.takeN(leader.seen, 2);
        assert.strictEqual(firstDelta[1]?._tag, "Delta");

        const joiner = yield* askInBackground(question("who made tetris"));
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(leader.fiber);
        yield* Fiber.join(joiner.fiber);
        const joined = [...(yield* Queue.takeAll(joiner.seen))].map(
          (event) => event._tag,
        );
        assert.deepStrictEqual(joined.slice(-2), ["Failed", "Done"]);

        const later = yield* askInBackground(question("Who made Tetris?"));
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(later.fiber);
        assert.include(
          [...(yield* Queue.takeAll(later.seen))].map((event) => event._tag),
          "Failed",
        );
        assert.deepStrictEqual(yield* cacheResults, {
          miss: 2,
          coalesced: 1,
        });
      }).pipe(
        Effect.provide(
          answerCacheLayer(options).pipe(
            Layer.provide(cutOffChat),
            Layer.provide(Retriever.layerBm25),
            Layer.provide(fixture),
          ),
        ),
        Effect.provideService(Metric.MetricRegistry, new Map()),
      ),
  );

  it.effect("passes follow-up turns straight through", () =>
    withCache((upstreamCalls) =>
      Effect.gen(function* () {
        for (const _ of [1, 2]) {
          const fiber = yield* Effect.forkChild(ask(followUp));
          yield* answerFrom(yield* Queue.take(upstreamCalls), answer);
          yield* Fiber.join(fiber);
        }
        assert.deepStrictEqual(yield* cacheResults, { uncacheable: 2 });
      }),
    ),
  );

  it.effect("wraps the real grounded chat without changing its answer", () =>
    Effect.gen(function* () {
      const uncached = yield* ask(question("Who created Tetris?")).pipe(
        Effect.provide(
          realChat.pipe(
            Layer.provide(Retriever.layerBm25),
            Layer.provide(fixture),
          ),
        ),
      );
      const cached = yield* Effect.gen(function* () {
        const first = yield* ask(question("Who created Tetris?"));
        const second = yield* ask(question("who created tetris"));
        return [first, second];
      }).pipe(
        Effect.provide(
          answerCacheLayer(options).pipe(
            Layer.provide(realChat),
            Layer.provide(Retriever.layerBm25),
            Layer.provide(fixture),
          ),
        ),
      );
      assert.deepStrictEqual(cached, [uncached, uncached]);
    }).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
  );
});

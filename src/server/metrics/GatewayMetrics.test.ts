import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Duration, Effect, Layer, Metric } from "effect";
import { RateLimiter } from "effect/persistence";
import { answerCacheLayer } from "@/server/chat/AnswerCache";
import { type ChatProvider, GroundedChat } from "@/server/chat/GroundedChat";
import { corpusFixture, sovietUnion } from "@/server/corpus/CorpusFixture";
import {
  AnonymousSessions,
  type SessionPolicy,
} from "@/server/gateway/AnonymousSessions";
import { serveChat } from "@/server/gateway/ChatGateway";
import { CircuitBreaker } from "@/server/provider/CircuitBreaker";
import { MockProvider } from "@/server/provider/MockProvider";
import { Retriever } from "@/server/search/Retriever";
import { observedChat, observedRetrieval } from "./GatewayMetrics";
import { scrapeMetrics } from "./MetricsScrape";

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

const policy: SessionPolicy = {
  lifetime: "30 minutes",
  issuance: { limit: 10, window: "1 minute" },
  chatPerSession: { limit: 4, window: "1 minute" },
  chatOverall: { limit: 100, window: "1 minute" },
};

const gatewayWith = (model: ChatProvider["model"]) =>
  Layer.mergeAll(
    observedChat.pipe(
      Layer.provide(
        answerCacheLayer({
          capacity: 10,
          timeToLive: "10 minutes",
        }),
      ),
      Layer.provide(
        GroundedChat.layer(
          [
            {
              id: "mock-extractive",
              provider: "mock",
              model,
            },
          ],
          Duration.seconds(2),
        ).pipe(Layer.provide(CircuitBreaker.layer)),
      ),
    ),
    Layer.effect(AnonymousSessions, AnonymousSessions.make(policy)).pipe(
      Layer.provide(RateLimiter.layer),
      Layer.provide(RateLimiter.layerStoreMemory),
    ),
  ).pipe(
    Layer.provide(observedRetrieval.pipe(Layer.provide(Retriever.layerBm25))),
    Layer.provide(fixture),
  );

const gateway = gatewayWith(
  MockProvider.extractive({ tokenDelay: Duration.zero }),
);

const sensitiveQuestion = "Which puzzle game helps with my anxiety medication?";

const chat = (token: string | null, content: string) =>
  Effect.gen(function* () {
    const response = yield* serveChat(token, {
      messages: [{ role: "user", content }],
      scope: {},
    });
    yield* Effect.promise(() => response.text());
    return response.status;
  });

const labelKeys = (exposition: string) =>
  new Set(
    exposition
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .flatMap((line) =>
        [...(/\{(.*)\}/.exec(line)?.[1] ?? "").matchAll(/(\w+)="/g)].map(
          (match) => match[1],
        ),
      ),
  );

const allowedLabelKeys = new Set(["le", "outcome", "result", "model"]);

const sample = (exposition: string, series: string) =>
  exposition
    .split("\n")
    .find((line) => line.startsWith(`${series} `))
    ?.slice(series.length + 1);

describe("gateway metrics", () => {
  it.effect(
    "count outcomes and cache results without the question, the token, or unbounded labels",
    () =>
      Effect.gen(function* () {
        const sessions = yield* AnonymousSessions;
        const { token } = yield* sessions.issue;
        const statuses = [
          yield* chat(token, sensitiveQuestion),
          yield* chat(token, sensitiveQuestion.toLowerCase()),
          yield* chat(token, "Who created Tetris?"),
          yield* chat(token, "Who created Tetris?"),
          yield* chat(token, "Who created Tetris?"),
          yield* chat(null, sensitiveQuestion),
          yield* serveChat(token, { messages: [] }).pipe(
            Effect.map((response) => response.status),
          ),
        ];
        assert.deepStrictEqual(statuses, [200, 200, 200, 200, 429, 401, 400]);

        const scraped = yield* scrapeMetrics(null);
        const exposition = yield* Effect.promise(() => scraped.text());
        const [, id, , signature] = token.split(".");
        for (const secret of [
          sensitiveQuestion,
          sensitiveQuestion.toLowerCase(),
          "anxiety",
          "medication",
          "Tetris",
          token,
          id!,
          signature!,
        ]) {
          assert.notInclude(exposition, secret);
        }
        for (const key of labelKeys(exposition)) {
          assert.isTrue(allowedLabelKeys.has(key!), `unexpected label ${key}`);
        }

        const expected = {
          'chat_requests_total{outcome="ok"}': "4",
          'chat_requests_total{outcome="rate_limited"}': "1",
          'chat_requests_total{outcome="invalid"}': "2",
          'answer_cache_requests_total{result="hit"}': "2",
          'answer_cache_requests_total{result="miss"}': "2",
          'chat_answers_total{model="mock-extractive"}': "4",
          chat_time_to_first_token_seconds_count: "4",
          retrieval_duration_seconds_count: "2",
        };
        for (const [series, value] of Object.entries(expected)) {
          assert.strictEqual(sample(exposition, series), value, series);
        }
      }).pipe(
        Effect.provide(gateway),
        Effect.provideService(Metric.MetricRegistry, new Map()),
      ),
  );

  it.effect("count an answer the provider cut off as failed", () =>
    Effect.gen(function* () {
      const sessions = yield* AnonymousSessions;
      const { token } = yield* sessions.issue;
      assert.strictEqual(yield* chat(token, "Who created Tetris?"), 200);

      const scraped = yield* scrapeMetrics(null);
      const exposition = yield* Effect.promise(() => scraped.text());
      assert.strictEqual(
        sample(exposition, 'chat_requests_total{outcome="failed"}'),
        "1",
      );
      assert.isUndefined(
        sample(exposition, 'chat_requests_total{outcome="ok"}'),
      );
      assert.notInclude(exposition, "chat_answers_total{");
    }).pipe(
      Effect.provide(
        gatewayWith(
          MockProvider.model({
            tokenDelay: Duration.zero,
            finishReason: "length",
          }),
        ),
      ),
      Effect.provideService(Metric.MetricRegistry, new Map()),
    ),
  );

  it.effect("require METRICS_TOKEN as a bearer token when it is set", () =>
    Effect.gen(function* () {
      const status = (token: string | null) =>
        Effect.map(scrapeMetrics(token), (response) => response.status);
      assert.deepStrictEqual(
        [
          yield* status(null),
          yield* status("wrong"),
          yield* status("scrape-secret"),
        ],
        [401, 401, 200],
      );
    }).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({ METRICS_TOKEN: "scrape-secret" }),
      ),
    ),
  );
});

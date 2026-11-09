import { Clock, Effect, Exit, Layer, Metric, Stream } from "effect";
import type { ChatEvent } from "@/server/chat/ChatProtocol";
import { GroundedChat } from "@/server/chat/GroundedChat";
import { Retriever } from "@/server/search/Retriever";

const secondBoundaries = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

const timeToFirstToken = Metric.histogram("chat_time_to_first_token_seconds", {
  description: "Time from the start of a chat stream to its first answer text",
  boundaries: secondBoundaries,
});

const retrievalDuration = Metric.histogram("retrieval_duration_seconds", {
  description: "Time to retrieve passages for one search",
  boundaries: secondBoundaries,
});

const chatRequests = Metric.counter("chat_requests_total", {
  description:
    "Chat requests by outcome: ok, failed (the user saw a provider failure), rate_limited, or invalid (bad request or expired session)",
  incremental: true,
});

const chatAnswers = Metric.counter("chat_answers_total", {
  description:
    "Complete answers by the model that wrote them, or none when no article in scope matched",
  incremental: true,
});

export type ChatOutcome = "ok" | "failed" | "rate_limited" | "invalid";

export const countChat = (outcome: ChatOutcome) =>
  Metric.update(Metric.withAttributes(chatRequests, { outcome }), 1);

const countAnswer = (model: string | null) =>
  Metric.update(
    Metric.withAttributes(chatAnswers, { model: model ?? "none" }),
    1,
  );

const secondsSince = (startedAt: number) =>
  Effect.map(Clock.currentTimeMillis, (now) => (now - startedAt) / 1000);

const observeChat = Effect.fn("GatewayMetrics.observeChat")(function* (
  events: Stream.Stream<ChatEvent>,
) {
  const startedAt = yield* Clock.currentTimeMillis;
  let awaitingFirstToken = true;
  let failed = false;
  let model: string | null = null;

  const record = Effect.fnUntraced(function* (event: ChatEvent) {
    if (event._tag === "Delta" && awaitingFirstToken) {
      awaitingFirstToken = false;
      yield* Metric.update(timeToFirstToken, yield* secondsSince(startedAt));
    }
    if (event._tag === "Failed") failed = true;
    if (event._tag === "Done") model = event.model;
  });

  const settle = Effect.fnUntraced(function* (exit: Exit.Exit<unknown>) {
    if (Exit.hasInterrupts(exit)) return;
    if (failed || Exit.isFailure(exit)) return yield* countChat("failed");
    yield* countChat("ok");
    yield* countAnswer(model);
  });

  return events.pipe(Stream.tap(record), Stream.onExit(settle));
});

export const observedChat = Layer.effect(
  GroundedChat,
  Effect.map(GroundedChat, (chat) =>
    GroundedChat.of({
      models: chat.models,
      stream: (request) =>
        Effect.map(chat.stream(request), (events) =>
          Stream.unwrap(observeChat(events)),
        ),
    }),
  ),
);

export const observedRetrieval = Layer.effect(
  Retriever,
  Effect.map(Retriever, (retriever) =>
    Retriever.of({
      search: (request) =>
        Effect.gen(function* () {
          const startedAt = yield* Clock.currentTimeMillis;
          const passages = yield* retriever.search(request);
          yield* Metric.update(
            retrievalDuration,
            yield* secondsSince(startedAt),
          );
          return passages;
        }),
    }),
  ),
);

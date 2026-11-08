import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  Schema,
  Stream,
} from "effect";
import { AiError, LanguageModel } from "effect/ai";
import { TestClock } from "effect/testing";
import { ChatError, ChatStream } from "@/server/chat/ChatStream";
import { MockProvider } from "@/server/provider/MockProvider";

const tokenDelay = "100 millis";

const replyingChat = ChatStream.layer.pipe(
  Layer.provide(MockProvider.model({ reply: "Hello there", tokenDelay })),
);

const failingChat = ChatStream.layer.pipe(Layer.provide(MockProvider.failing));

const requestEchoingOutage = (options: LanguageModel.ProviderOptions) =>
  AiError.make({
    module: "EchoingProvider",
    method: "streamText",
    reason: new AiError.InvalidRequestError({
      description: "The provider rejected the request.",
      http: { body: JSON.stringify({ rejected: options.prompt }) },
    }),
  });

const requestEchoingChat = ChatStream.layer.pipe(
  Layer.provide(
    Layer.effect(
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText: (options) => Effect.fail(requestEchoingOutage(options)),
        streamText: (options) => Stream.fail(requestEchoingOutage(options)),
      }),
    ),
  ),
);

describe("ChatStream.reply", () => {
  it.effect("emits each token as soon as the provider sends it", () =>
    Effect.gen(function* () {
      const chat = yield* ChatStream;
      const received = yield* Queue.unbounded<string>();
      const consumer = yield* chat.reply("hi").pipe(
        Stream.runForEach((delta) => Queue.offer(received, delta)),
        Effect.forkChild,
      );

      yield* TestClock.adjust(tokenDelay);
      assert.deepStrictEqual(
        yield* Queue.poll(received),
        Option.some("Hello "),
      );
      assert.deepStrictEqual(yield* Queue.poll(received), Option.none());

      yield* TestClock.adjust(tokenDelay);
      yield* Fiber.join(consumer);
      assert.deepStrictEqual(yield* Queue.poll(received), Option.some("there"));
    }).pipe(Effect.provide(replyingChat)),
  );

  it.effect("fails with the provider's reason when the provider fails", () =>
    Effect.gen(function* () {
      const chat = yield* ChatStream;
      const error = yield* chat.reply("hi").pipe(Stream.runDrain, Effect.flip);
      assert.deepStrictEqual(
        error,
        new ChatError({ reason: "InternalProviderError", retryable: true }),
      );
    }).pipe(Effect.provide(failingChat)),
  );

  it.effect(
    "keeps the user's message out of the error when the provider echoes it",
    () =>
      Effect.gen(function* () {
        const message = "what are the side effects of my prescription";
        const chat = yield* ChatStream;
        const error = yield* chat
          .reply(message)
          .pipe(Stream.runDrain, Effect.flip);

        assert.notInclude(Cause.pretty(Cause.fail(error)), message);
        assert.notInclude(
          JSON.stringify(Schema.encodeSync(ChatError)(error)),
          message,
        );
      }).pipe(Effect.provide(requestEchoingChat)),
  );
});

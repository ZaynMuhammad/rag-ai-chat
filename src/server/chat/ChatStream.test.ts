import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { ChatStream } from "@/server/chat/ChatStream";
import { MockProvider } from "@/server/provider/MockProvider";

const tokenDelay = "100 millis";

const replyingChat = ChatStream.layer.pipe(
  Layer.provide(MockProvider.model({ reply: "Hello there", tokenDelay })),
);

const failingChat = ChatStream.layer.pipe(Layer.provide(MockProvider.failing));

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
      assert.strictEqual(error.reason._tag, "InternalProviderError");
    }).pipe(Effect.provide(failingChat)),
  );
});

import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Stream } from "effect";
import { TestClock } from "effect/testing";
import type { Article } from "@/rag/Article";
import { Retriever } from "@/rag/Retriever";
import { Chat } from "./Chat";
import type { ChatEvent } from "./ChatProtocol";
import { MockProvider, Provider, ProviderError } from "./Provider";

const moon: Article = {
  id: "moon",
  title: "Moon",
  summary: "The Moon orbits Earth. It causes tides.",
  url: "https://example.test/moon",
};

const retrieverLayer = Layer.succeed(Retriever, Retriever.make([moon]));

const chatWith = (provider: Layer.Layer<Provider>) =>
  Chat.layer.pipe(Layer.provide(retrieverLayer), Layer.provide(provider));

const collect = (articleIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const chat = yield* Chat;
    const fiber = yield* chat
      .stream({ messages: [{ role: "user", content: "Tell me about the moon" }], articleIds })
      .pipe(Stream.runCollect, Effect.forkChild);
    yield* TestClock.adjust("1 minute");
    return yield* Fiber.join(fiber);
  });

const text = (events: ReadonlyArray<ChatEvent>) =>
  events.flatMap((event) => (event._tag === "Delta" ? [event.text] : [])).join("");

describe("Chat", () => {
  it.effect("streams citations, then the cited answer, then done", () =>
    Effect.gen(function* () {
      const events = yield* collect(["moon"]);
      const first = events[0];
      assert.strictEqual(first?._tag, "Citations");
      assert.deepStrictEqual(
        first?._tag === "Citations" ? first.passages.map((passage) => passage.articleId) : [],
        ["moon"],
      );
      assert.strictEqual(text(events), "From the selected articles: The Moon orbits Earth. [1]");
      assert.strictEqual(events.at(-1)?._tag, "Done");
    }).pipe(Effect.provide(chatWith(MockProvider.layer({ tokenDelay: "25 millis" })))),
  );

  it.effect("answers ungrounded with no citations when nothing is selected", () =>
    Effect.gen(function* () {
      const events = yield* collect([]);
      const first = events[0];
      assert.deepStrictEqual(first?._tag === "Citations" ? first.passages : undefined, []);
      assert.include(text(events), "not grounded");
    }).pipe(Effect.provide(chatWith(MockProvider.layer({ tokenDelay: "25 millis" })))),
  );

  it.effect("turns a provider failure into a Failed event and still finishes", () =>
    Effect.gen(function* () {
      const events = yield* collect(["moon"]);
      assert.deepStrictEqual(
        events.map((event) => event._tag),
        ["Citations", "Delta", "Failed", "Done"],
      );
    }).pipe(
      Effect.provide(
        chatWith(
          Layer.succeed(
            Provider,
            Provider.of({
              name: "broken",
              stream: () =>
                Stream.make("partial ").pipe(
                  Stream.concat(
                    Stream.fail(new ProviderError({ provider: "broken", message: "503" })),
                  ),
                ),
            }),
          ),
        ),
      ),
    ),
  );
});

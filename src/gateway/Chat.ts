import { Context, Effect, Layer, Stream } from "effect";
import { Retriever } from "@/rag/Retriever";
import type { ChatEvent, ChatRequest } from "./ChatProtocol";
import { Provider } from "./Provider";

const providerFailed: ChatEvent = {
  _tag: "Failed",
  message: "The model provider failed. Try again.",
};

export class Chat extends Context.Service<
  Chat,
  { stream(request: ChatRequest): Stream.Stream<ChatEvent> }
>()("rag-ai-chat/gateway/Chat") {
  static readonly layer = Layer.effect(
    Chat,
    Effect.gen(function* () {
      const retriever = yield* Retriever;
      const provider = yield* Provider;

      const answer = Effect.fn("Chat.stream")(function* (request: ChatRequest) {
        const question =
          request.messages.findLast((message) => message.role === "user")?.content ?? "";
        const passages = yield* retriever.retrieve(question, request.articleIds);
        return Stream.succeed<ChatEvent>({ _tag: "Citations", passages }).pipe(
          Stream.concat(
            provider.stream({ messages: request.messages, passages }).pipe(
              Stream.map((text): ChatEvent => ({ _tag: "Delta", text })),
              Stream.catch(() => Stream.succeed(providerFailed)),
            ),
          ),
          Stream.concat(Stream.succeed<ChatEvent>({ _tag: "Done" })),
        );
      });

      return Chat.of({ stream: (request) => Stream.unwrap(answer(request)) });
    }),
  );
}

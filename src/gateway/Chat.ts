import { Context, Effect, Layer, Stream } from "effect";
import { Retriever } from "@/rag/Retriever";
import type { ChatEvent, ChatRequest } from "./ChatProtocol";
import { Provider } from "./Provider";

export class Chat extends Context.Service<
  Chat,
  { stream(request: ChatRequest): Stream.Stream<ChatEvent> }
>()("rag-ai-chat/gateway/Chat") {
  static readonly layer = Layer.effect(
    Chat,
    Effect.gen(function* () {
      const retriever = yield* Retriever;
      const provider = yield* Provider;

      const stream = (request: ChatRequest): Stream.Stream<ChatEvent> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const question =
              request.messages.findLast((message) => message.role === "user")?.content ?? "";
            const passages = yield* retriever.retrieve(question, request.articleIds);
            const answer = provider
              .stream({ messages: request.messages, passages })
              .pipe(
                Stream.map((text): ChatEvent => ({ _tag: "Delta", text })),
                Stream.catch(() =>
                  Stream.succeed<ChatEvent>({
                    _tag: "Failed",
                    message: "The model provider failed. Try again.",
                  }),
                ),
              );
            return Stream.succeed<ChatEvent>({ _tag: "Citations", passages }).pipe(
              Stream.concat(answer),
              Stream.concat(Stream.succeed<ChatEvent>({ _tag: "Done" })),
            );
          }).pipe(Effect.withSpan("Chat.stream")),
        );

      return Chat.of({ stream });
    }),
  );
}

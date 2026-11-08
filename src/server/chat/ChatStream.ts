import { Context, Effect, Layer, Schema, Stream } from "effect";
import { type AiError, LanguageModel, type Response } from "effect/ai";

export class ChatError extends Schema.TaggedError<ChatError>()("ChatError", {
  reason: Schema.String,
  retryable: Schema.Boolean,
}) {
  static fromAiError(error: AiError.AiError) {
    return new ChatError({
      reason: error.reason._tag,
      retryable: error.isRetryable,
    });
  }
}

const isTextDelta = (part: Response.AnyPart): part is Response.TextDeltaPart =>
  part.type === "text-delta";

export class ChatStream extends Context.Service<
  ChatStream,
  {
    reply(message: string): Stream.Stream<string, ChatError>;
  }
>()("rag-ai-chat/ChatStream") {
  static readonly layer = Layer.effect(
    ChatStream,
    Effect.gen(function* () {
      const model = yield* LanguageModel.LanguageModel;

      const reply = (message: string) =>
        model.streamText({ prompt: message }).pipe(
          Stream.filter(isTextDelta),
          Stream.map((part) => part.delta),
          Stream.mapError((error) => ChatError.fromAiError(error)),
          Stream.withSpan("ChatStream.reply"),
        );

      return ChatStream.of({ reply });
    }),
  );
}

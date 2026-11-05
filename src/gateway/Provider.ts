import { Context, Duration, Effect, Layer, Schema, Stream } from "effect";
import type { Passage } from "@/rag/Article";
import type { ChatMessage } from "./ChatProtocol";

export class ProviderError extends Schema.TaggedError<ProviderError>()(
  "ProviderError",
  { provider: Schema.String, message: Schema.String },
) {}

export interface ProviderInput {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly passages: ReadonlyArray<Passage>;
}

export class Provider extends Context.Service<
  Provider,
  {
    readonly name: string;
    stream(input: ProviderInput): Stream.Stream<string, ProviderError>;
  }
>()("rag-ai-chat/gateway/Provider") {}

const firstSentence = (text: string) => text.split(/(?<=\.)\s/)[0] ?? text;

export const mockReply = ({ messages, passages }: ProviderInput) => {
  const question = messages.findLast((message) => message.role === "user")?.content ?? "";
  if (passages.length === 0) {
    return `This is the mock provider. No passages matched, so this answer is not grounded. You asked: "${question}"`;
  }
  const cited = passages.map(
    (passage, index) => `${firstSentence(passage.text)} [${index + 1}]`,
  );
  return `From the selected articles: ${cited.join(" ")}`;
};

const tokens = (text: string) => text.split(/(?<=\s)/);

export const MockProvider = {
  layer: (options: { readonly tokenDelay: Duration.Input }) =>
    Layer.succeed(
      Provider,
      Provider.of({
        name: "mock",
        stream: (input) =>
          Stream.fromIterable(tokens(mockReply(input))).pipe(
            Stream.mapEffect((token) => Effect.as(Effect.sleep(options.tokenDelay), token)),
          ),
      }),
    ),
};

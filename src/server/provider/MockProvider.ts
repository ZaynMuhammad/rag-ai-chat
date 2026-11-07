import { Duration, Effect, Layer, Stream } from "effect";
import { AiError, LanguageModel, Model, type Response } from "effect/ai";

export interface MockProviderOptions {
  readonly reply?: string;
  readonly tokenDelay?: Duration.Input;
}

const defaultReply = "This is a reply from the mock provider.";
const defaultTokenDelay = Duration.millis(20);
const textId = "mock-text";

const finishPart = (outputTokens: number): Response.FinishPartEncoded => ({
  type: "finish",
  reason: "stop",
  usage: {
    inputTokens: {
      uncached: undefined,
      total: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens,
      reasoning: undefined,
    },
  },
  response: undefined,
});

const tokenize = (text: string) => text.split(/(?<=\s)/);

const replyingModel = ({
  reply = defaultReply,
  tokenDelay = defaultTokenDelay,
}: MockProviderOptions) => {
  const tokens = tokenize(reply);
  const streamParts: ReadonlyArray<Response.StreamPartEncoded> = [
    { type: "text-start", id: textId },
    ...tokens.map((delta) => ({
      type: "text-delta" as const,
      id: textId,
      delta,
    })),
    { type: "text-end", id: textId },
    finishPart(tokens.length),
  ];
  const delayBefore = (part: Response.StreamPartEncoded) =>
    part.type === "text-delta" ? tokenDelay : Duration.zero;

  return LanguageModel.make({
    generateText: () =>
      Effect.succeed([
        { type: "text", text: reply },
        finishPart(tokens.length),
      ]),
    streamText: () =>
      Stream.fromIterable(streamParts).pipe(
        Stream.mapEffect((part) =>
          Effect.sleep(delayBefore(part)).pipe(Effect.as(part)),
        ),
      ),
  });
};

const outage = (method: string) =>
  AiError.make({
    module: "MockProvider",
    method,
    reason: new AiError.InternalProviderError({
      description: "The mock provider is simulating an outage.",
    }),
  });

const failingModel = LanguageModel.make({
  generateText: () => Effect.fail(outage("generateText")),
  streamText: () => Stream.fail(outage("streamText")),
});

export const MockProvider = {
  model: (options: MockProviderOptions = {}) =>
    Model.make(
      "mock",
      "mock-replying",
      Layer.effect(LanguageModel.LanguageModel, replyingModel(options)),
    ),
  failing: Model.make(
    "mock",
    "mock-failing",
    Layer.effect(LanguageModel.LanguageModel, failingModel),
  ),
};

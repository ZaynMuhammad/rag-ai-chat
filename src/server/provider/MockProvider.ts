import { Duration, Effect, Layer, Stream } from "effect";
import {
  AiError,
  LanguageModel,
  Model,
  type Prompt,
  type Response,
} from "effect/ai";
import { lastUserText, parseGroundedTurn } from "@/server/chat/GroundedPrompt";
import { extractiveAnswer } from "./ExtractiveAnswer";

export interface MockProviderOptions {
  readonly reply?: string | ((prompt: Prompt.Prompt) => string);
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

const streamParts = (
  reply: string,
  tokenDelay: Duration.Input,
): Stream.Stream<Response.StreamPartEncoded> => {
  const tokens = tokenize(reply);
  const parts: ReadonlyArray<Response.StreamPartEncoded> = [
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
  return Stream.fromIterable(parts).pipe(
    Stream.mapEffect((part) =>
      Effect.sleep(delayBefore(part)).pipe(Effect.as(part)),
    ),
  );
};

const replyingModel = ({
  reply = defaultReply,
  tokenDelay = defaultTokenDelay,
}: MockProviderOptions) => {
  const replyTo = (prompt: Prompt.Prompt) =>
    typeof reply === "string" ? reply : reply(prompt);
  return LanguageModel.make({
    generateText: ({ prompt }) => {
      const text = replyTo(prompt);
      return Effect.succeed([
        { type: "text", text },
        finishPart(tokenize(text).length),
      ]);
    },
    streamText: ({ prompt }) => streamParts(replyTo(prompt), tokenDelay),
  });
};

const extractiveReply = (prompt: Prompt.Prompt) =>
  extractiveAnswer(parseGroundedTurn(lastUserText(prompt)));

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
  extractive: (options: Omit<MockProviderOptions, "reply"> = {}) =>
    Model.make(
      "mock",
      "mock-extractive",
      Layer.effect(
        LanguageModel.LanguageModel,
        replyingModel({ ...options, reply: extractiveReply }),
      ),
    ),
  failing: Model.make(
    "mock",
    "mock-failing",
    Layer.effect(LanguageModel.LanguageModel, failingModel),
  ),
};

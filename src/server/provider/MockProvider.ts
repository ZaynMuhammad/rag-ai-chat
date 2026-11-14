import {
  Clock,
  Duration,
  Effect,
  Layer,
  Option,
  Random,
  Ref,
  Schema,
  Stream,
} from "effect";
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
  readonly before?: Effect.Effect<void, AiError.AiError>;
  readonly finishReason?: Response.FinishReason | "none";
}

const defaultReply = "This is a reply from the mock provider.";
const defaultTokenDelay = Duration.millis(20);
const textId = "mock-text";

export const finishPart = (
  reason: Response.FinishReason,
  outputTokens: number,
): Response.FinishPartEncoded => ({
  type: "finish",
  reason,
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
  finishReason: Response.FinishReason | "none",
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
    ...(finishReason === "none"
      ? []
      : [finishPart(finishReason, tokens.length)]),
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
  before = Effect.void,
  finishReason = "stop",
}: MockProviderOptions) => {
  const replyTo = (prompt: Prompt.Prompt) =>
    typeof reply === "string" ? reply : reply(prompt);
  return LanguageModel.make({
    generateText: ({ prompt }) =>
      Effect.map(before, () => {
        const text = replyTo(prompt);
        return [
          { type: "text" as const, text },
          finishPart("stop", tokenize(text).length),
        ];
      }),
    streamText: ({ prompt }) =>
      Stream.unwrap(
        Effect.map(before, () =>
          streamParts(replyTo(prompt), tokenDelay, finishReason),
        ),
      ),
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

export type MockMode =
  | { readonly _tag: "ok" }
  | { readonly _tag: "outage" }
  | { readonly _tag: "hang" }
  | { readonly _tag: "slow" }
  | { readonly _tag: "flaky"; readonly failureRate: number };

export interface MockPhase {
  readonly mode: MockMode;
  readonly seconds: number | undefined;
}

export const outageLatency = Duration.millis(500);
export const slowFirstToken = Duration.seconds(5);

const misbehave = (mode: MockMode): Effect.Effect<void, AiError.AiError> => {
  switch (mode._tag) {
    case "ok":
      return Effect.void;
    case "outage":
      return Effect.andThen(
        Effect.sleep(outageLatency),
        Effect.fail(outage("streamText")),
      );
    case "hang":
      return Effect.never;
    case "slow":
      return Effect.sleep(slowFirstToken);
    case "flaky":
      return Effect.flatMap(Random.next, (roll) =>
        roll < mode.failureRate ? misbehave({ _tag: "outage" }) : Effect.void,
      );
  }
};

const modeAt = (
  phases: ReadonlyArray<MockPhase>,
  elapsedSeconds: number,
): MockMode => {
  let end = 0;
  for (const phase of phases) {
    end += phase.seconds ?? Infinity;
    if (elapsedSeconds < end) return phase.mode;
  }
  return phases.at(-1)?.mode ?? { _tag: "ok" };
};

const mockModePattern = String.raw`(ok|outage|hang|slow|flaky:(0(\.\d+)?|1(\.0+)?))(@\d+)?`;

export const MockSchedule = Schema.String.check(
  Schema.isPattern(new RegExp(`^${mockModePattern}(,${mockModePattern})*$`)),
);

const parseMode = (text: string): MockMode => {
  const [name, rate] = text.split(":");
  if (name === "outage" || name === "hang" || name === "slow") {
    return { _tag: name };
  }
  if (name === "flaky") return { _tag: "flaky", failureRate: Number(rate) };
  return { _tag: "ok" };
};

export const parseMockSchedule = (schedule: string): Array<MockPhase> =>
  schedule.split(",").map((item) => {
    const [mode = "ok", seconds] = item.split("@");
    return {
      mode: parseMode(mode),
      seconds: seconds === undefined ? undefined : Number(seconds),
    };
  });

const primaryModel = (phases: ReadonlyArray<MockPhase>) =>
  Effect.map(Ref.make(Option.none<number>()), (startedAt) => {
    const currentMode = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const start = yield* Ref.modify(startedAt, (started) =>
        Option.match(started, {
          onNone: () => [now, Option.some(now)] as const,
          onSome: (at) => [at, started] as const,
        }),
      );
      return modeAt(phases, (now - start) / 1000);
    });
    return Model.make(
      "mock",
      "mock-primary",
      Layer.effect(
        LanguageModel.LanguageModel,
        replyingModel({
          reply: extractiveReply,
          tokenDelay: Duration.millis(15),
          before: Effect.flatMap(currentMode, misbehave),
        }),
      ),
    );
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
  primary: primaryModel,
  failing: Model.make(
    "mock",
    "mock-failing",
    Layer.effect(LanguageModel.LanguageModel, failingModel),
  ),
};

import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import { Array as Arr, Config, Duration, Effect, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import type { ChatProvider } from "@/server/chat/GroundedChat";
import { MockProvider, MockSchedule, parseMockSchedule } from "./MockProvider";

const maxAnswerTokens = 1024;

const extractive: ChatProvider = {
  id: "mock-extractive",
  provider: "mock",
  model: MockProvider.extractive({ tokenDelay: Duration.millis(15) }),
};

type AnthropicConfig = Parameters<typeof AnthropicLanguageModel.model>[1];

export const anthropic = (
  model: string,
  config: AnthropicConfig = {
    max_tokens: maxAnswerTokens,
    output_config: { effort: "low" },
  },
) =>
  AnthropicLanguageModel.model(model, config).pipe(
    Layer.provide(
      AnthropicClient.layerConfig({
        apiKey: Config.Redacted("ANTHROPIC_API_KEY"),
      }),
    ),
    Layer.provide(FetchHttpClient.layer),
    Layer.orDie,
  );

const openAiCompatible = (model: string) =>
  OpenAiLanguageModel.model(model, {
    max_output_tokens: maxAnswerTokens,
  }).pipe(
    Layer.provide(
      OpenAiClient.layerConfig({
        apiKey: Config.option(Config.Redacted("OPENAI_API_KEY")).pipe(
          Config.map(Option.getOrUndefined),
        ),
        apiUrl: Config.String("OPENAI_BASE_URL").pipe(
          Config.withDefault("https://api.openai.com/v1"),
        ),
      }),
    ),
    Layer.provide(FetchHttpClient.layer),
    Layer.orDie,
  );

const mockPrimary = Effect.gen(function* () {
  const schedule = yield* Config.option(
    Config.schema(MockSchedule, "MOCK_PRIMARY"),
  );
  if (Option.isNone(schedule)) return [];
  const model = yield* MockProvider.primary(parseMockSchedule(schedule.value));
  return [{ id: "mock-primary", provider: "mock", model }];
});

const anthropicProviders = Effect.gen(function* () {
  const apiKey = yield* Config.option(Config.Redacted("ANTHROPIC_API_KEY"));
  if (Option.isNone(apiKey)) return [];
  const model = yield* Config.String("ANTHROPIC_MODEL").pipe(
    Config.withDefault("claude-haiku-5-5"),
  );
  return [{ id: model, provider: "anthropic", model: anthropic(model) }];
});

const openAiProviders = Effect.gen(function* () {
  const model = yield* Config.option(Config.String("OPENAI_MODEL"));
  if (Option.isNone(model)) return [];
  return [
    {
      id: model.value,
      provider: "openai",
      model: openAiCompatible(model.value),
    },
  ];
});

export const firstTokenDeadline = Config.Duration("FIRST_TOKEN_TIMEOUT").pipe(
  Config.withDefault(Duration.seconds(2)),
);

export const chatProviders = Effect.gen(function* () {
  const primaries: Array<ChatProvider> = [
    ...(yield* mockPrimary),
    ...(yield* anthropicProviders),
    ...(yield* openAiProviders),
  ];
  return Arr.append(primaries, extractive);
});

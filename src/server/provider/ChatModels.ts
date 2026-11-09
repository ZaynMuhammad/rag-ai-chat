import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { Config, Duration, Effect, ExecutionPlan, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import type { ChatPlan } from "@/server/chat/GroundedChat";
import { MockProvider } from "./MockProvider";

const extractive = MockProvider.extractive({ tokenDelay: Duration.millis(15) });

const anthropic = (model: string) =>
  AnthropicLanguageModel.model(model, {
    max_tokens: 1024,
    output_config: { effort: "low" },
  }).pipe(
    Layer.provide(
      AnthropicClient.layerConfig({
        apiKey: Config.Redacted("ANTHROPIC_API_KEY"),
      }),
    ),
    Layer.provide(FetchHttpClient.layer),
    Layer.orDie,
  );

const anthropicModel = Effect.gen(function* () {
  const apiKey = yield* Config.option(Config.Redacted("ANTHROPIC_API_KEY"));
  if (Option.isNone(apiKey)) return Option.none<string>();
  return Option.some(
    yield* Config.String("ANTHROPIC_MODEL").pipe(
      Config.withDefault("claude-haiku-5-5"),
    ),
  );
});

export const chatPlan: Effect.Effect<ChatPlan, Config.ConfigError> = Effect.map(
  anthropicModel,
  Option.match({
    onNone: () => ExecutionPlan.make({ provide: extractive }),
    onSome: (model) =>
      ExecutionPlan.make(
        { provide: anthropic(model), attempts: 2 },
        { provide: extractive },
      ),
  }),
);

export const chatPlanIdentity = Effect.map(
  anthropicModel,
  Option.match({
    onNone: () => "mock-extractive",
    onSome: (model) => `anthropic:${model},mock-extractive`,
  }),
);

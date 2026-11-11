import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { Config, Duration, Effect, ExecutionPlan, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import type { ChatPlan } from "@/server/chat/GroundedChat";
import { MockProvider } from "./MockProvider";

const extractive = MockProvider.extractive({ tokenDelay: Duration.millis(15) });

type AnthropicConfig = Parameters<typeof AnthropicLanguageModel.model>[1];

export const anthropic = (
  model: string,
  config: AnthropicConfig = {
    max_tokens: 1024,
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

export const chatPlan: Effect.Effect<ChatPlan, Config.ConfigError> = Effect.gen(
  function* () {
    const apiKey = yield* Config.option(Config.Redacted("ANTHROPIC_API_KEY"));
    if (Option.isNone(apiKey))
      return ExecutionPlan.make({ provide: extractive });
    const model = yield* Config.String("ANTHROPIC_MODEL").pipe(
      Config.withDefault("claude-haiku-5-5"),
    );
    return ExecutionPlan.make(
      { provide: anthropic(model), attempts: 2 },
      { provide: extractive },
    );
  },
);

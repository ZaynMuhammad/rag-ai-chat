import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import {
  Array as Arr,
  Config,
  Duration,
  Effect,
  ExecutionPlan,
  Layer,
  Option,
} from "effect";
import { FetchHttpClient } from "effect/http";
import type { ChatPlan } from "@/server/chat/GroundedChat";
import { MockProvider, MockSchedule, parseMockSchedule } from "./MockProvider";

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

const fallback: ChatPlan = ExecutionPlan.make({ provide: extractive });

const mockPrimary = Effect.gen(function* () {
  const schedule = yield* Config.option(
    Config.schema(MockSchedule, "MOCK_PRIMARY"),
  );
  if (Option.isNone(schedule)) return [];
  const model = yield* MockProvider.primary(parseMockSchedule(schedule.value));
  return [ExecutionPlan.make({ provide: model })];
});

const anthropicSteps = Effect.gen(function* () {
  const apiKey = yield* Config.option(Config.Redacted("ANTHROPIC_API_KEY"));
  if (Option.isNone(apiKey)) return [];
  const model = yield* Config.String("ANTHROPIC_MODEL").pipe(
    Config.withDefault("claude-haiku-5-5"),
  );
  return [ExecutionPlan.make({ provide: anthropic(model) })];
});

export const firstTokenDeadline = Config.Duration("FIRST_TOKEN_TIMEOUT").pipe(
  Config.withDefault(Duration.seconds(2)),
);

export const chatPlan: Effect.Effect<ChatPlan, Config.ConfigError> = Effect.gen(
  function* () {
    const primaries: Array<ChatPlan> = [
      ...(yield* mockPrimary),
      ...(yield* anthropicSteps),
    ];
    return ExecutionPlan.merge(...Arr.append(primaries, fallback));
  },
);

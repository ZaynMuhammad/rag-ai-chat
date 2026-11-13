import {
  Array as Arr,
  Context,
  type Duration,
  Effect,
  ExecutionPlan,
  Layer,
  Ref,
  Schema,
  Stream,
} from "effect";
import { LanguageModel, Model, Response } from "effect/ai";
import { CircuitBreaker } from "@/server/provider/CircuitBreaker";
import { notCovered } from "@/server/provider/ExtractiveAnswer";
import { type Budget, ProviderBudget } from "@/server/provider/ProviderBudget";
import { Retriever } from "@/server/search/Retriever";
import type { ChatEvent, ChatModelInfo, ChatRequest } from "./ChatProtocol";
import { estimatedPromptTokens, groundedPrompt } from "./GroundedPrompt";

export const passagesPerAnswer = 6;

export const providerFailed =
  "Every model provider failed to answer. Try again in a moment.";

export interface ChatProvider extends ChatModelInfo {
  readonly model: Layer.Layer<
    LanguageModel.LanguageModel | Model.ModelName | Model.ProviderName
  >;
  readonly budget?: Budget;
}

export class UnknownModel extends Schema.TaggedError<UnknownModel>()(
  "UnknownModel",
  {},
) {}

const planOf = (providers: Arr.NonEmptyReadonlyArray<ChatProvider>) =>
  ExecutionPlan.merge(
    ...Arr.map(providers, ({ model, budget }) =>
      ExecutionPlan.make({
        provide: Layer.merge(
          model,
          Layer.succeed(ProviderBudget, budget ?? ProviderBudget.unlimited),
        ),
      }),
    ),
  );

type ChatPlan = ReturnType<typeof planOf>;

export class FirstTokenTimeout extends Schema.TaggedError<FirstTokenTimeout>()(
  "FirstTokenTimeout",
  {},
) {}

const firstTokenWithin =
  (deadline: Duration.Input) =>
  <A, E, R>(stream: Stream.Stream<A, E, R>) =>
    Stream.transformPull(stream, (pull) =>
      Effect.sync(() => {
        let awaitingFirstToken = true;
        return Effect.suspend(() => {
          if (!awaitingFirstToken) return pull;
          awaitingFirstToken = false;
          return Effect.timeoutOrElse(pull, {
            duration: deadline,
            orElse: () => Effect.fail(new FirstTokenTimeout()),
          });
        });
      }),
    );

const isTextDelta = (part: Response.AnyPart): part is Response.TextDeltaPart =>
  part.type === "text-delta";

export class UnfinishedAnswer extends Schema.TaggedError<UnfinishedAnswer>()(
  "UnfinishedAnswer",
  { reason: Schema.Literals([...Response.FinishReason.literals, "none"]) },
) {}

const textUntilNaturalStop = <E, R>(
  parts: Stream.Stream<Response.AnyPart, E, R>,
) =>
  Stream.unwrap(
    Effect.map(Ref.make<UnfinishedAnswer["reason"]>("none"), (ending) => {
      const naturalStop = Stream.unwrap(
        Effect.map(Ref.get(ending), (reason) =>
          reason === "stop"
            ? Stream.empty
            : Stream.fail(new UnfinishedAnswer({ reason })),
        ),
      );
      return parts.pipe(
        Stream.tap((part) =>
          part.type === "finish" ? Ref.set(ending, part.reason) : Effect.void,
        ),
        Stream.filter(isTextDelta),
        Stream.map((part) => part.delta),
        Stream.concat(naturalStop),
      );
    }),
  );

const event = (value: ChatEvent) => Stream.succeed(value);

export class GroundedChat extends Context.Service<
  GroundedChat,
  {
    readonly models: Arr.NonEmptyReadonlyArray<ChatModelInfo>;
    stream(
      request: ChatRequest,
    ): Effect.Effect<Stream.Stream<ChatEvent>, UnknownModel>;
  }
>()("rag-ai-chat/chat/GroundedChat") {
  static readonly layer = (
    providers: Arr.NonEmptyReadonlyArray<ChatProvider>,
    firstTokenDeadline: Duration.Input,
  ) =>
    Layer.effect(
      GroundedChat,
      Effect.gen(function* () {
        const retriever = yield* Retriever;
        const breaker = yield* CircuitBreaker;
        const defaultPlan = planOf(providers);

        const planFor = Effect.fn("GroundedChat.planFor")(function* (
          model: string | undefined,
        ) {
          if (model === undefined) return defaultPlan;
          const chosen = providers.find((provider) => provider.id === model);
          if (chosen === undefined) return yield* new UnknownModel();
          return planOf([
            chosen,
            ...providers.filter((provider) => provider !== chosen),
          ]);
        });

        const answer = (
          prompt: ReturnType<typeof groundedPrompt>,
          plan: ChatPlan,
        ) => {
          const lastResort = plan.steps.length - 1;
          const promptTokens = estimatedPromptTokens(prompt);
          return Stream.unwrap(
            Effect.gen(function* () {
              const model = yield* Model.ModelName;
              const budget = yield* ProviderBudget;
              const { stepIndex } = yield* ExecutionPlan.CurrentMetadata;
              const refund = yield* budget.reserve(promptTokens);
              const tokens = LanguageModel.streamText({ prompt }).pipe(
                textUntilNaturalStop,
                Stream.map((text) => ({ model, text })),
                Stream.tapErrorTag("UnfinishedAnswer", ({ reason }) =>
                  Effect.logWarning("answer ended without a natural stop").pipe(
                    Effect.annotateLogs({ model, reason }),
                  ),
                ),
              );
              return stepIndex === lastResort
                ? tokens
                : tokens.pipe(
                    firstTokenWithin(firstTokenDeadline),
                    breaker.guard(model),
                    Stream.tapErrorTag("CircuitOpen", () => refund),
                  );
            }),
          ).pipe(
            Stream.withExecutionPlan(plan, {
              preventFallbackOnPartialStream: true,
            }),
          );
        };

        const respond = Effect.fn("GroundedChat.stream")(function* (
          request: ChatRequest,
          plan: ChatPlan,
        ) {
          const question =
            request.messages.findLast((message) => message.role === "user")
              ?.content ?? "";
          const passages = yield* retriever.search({
            query: question,
            scope: request.scope,
            limit: passagesPerAnswer,
          });
          const citations = event({ _tag: "Citations", passages });
          if (passages.length === 0) {
            return citations.pipe(
              Stream.concat(event({ _tag: "Delta", text: notCovered })),
              Stream.concat(event({ _tag: "Done", model: null })),
            );
          }
          const answeredBy = yield* Ref.make<string | null>(null);
          const deltas = answer(
            groundedPrompt(request.messages, passages),
            plan,
          ).pipe(
            Stream.tap(({ model }) => Ref.set(answeredBy, model)),
            Stream.map(({ text }): ChatEvent => ({ _tag: "Delta", text })),
            Stream.catchCause(() =>
              event({ _tag: "Failed", message: providerFailed }),
            ),
          );
          return citations.pipe(
            Stream.concat(deltas),
            Stream.concat(
              Stream.fromEffect(
                Effect.map(Ref.get(answeredBy), (model): ChatEvent => ({
                  _tag: "Done",
                  model,
                })),
              ),
            ),
          );
        });

        return GroundedChat.of({
          models: Arr.map(providers, ({ id, provider }) => ({ id, provider })),
          stream: (request) =>
            Effect.map(planFor(request.model), (plan) =>
              Stream.unwrap(respond(request, plan)),
            ),
        });
      }),
    );
}

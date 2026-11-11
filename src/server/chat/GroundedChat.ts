import {
  Context,
  Effect,
  type ExecutionPlan,
  Layer,
  Ref,
  Stream,
} from "effect";
import { LanguageModel, Model, type Response } from "effect/ai";
import { notCovered } from "@/server/provider/ExtractiveAnswer";
import { Retriever } from "@/server/search/Retriever";
import type { ChatEvent, ChatRequest } from "./ChatProtocol";
import { groundedPrompt } from "./GroundedPrompt";

export const passagesPerAnswer = 6;

export const providerFailed =
  "Every model provider failed to answer. Try again in a moment.";

export type ChatPlan = ExecutionPlan.ExecutionPlan<{
  provides: LanguageModel.LanguageModel | Model.ModelName | Model.ProviderName;
  input: unknown;
  error: never;
  requirements: never;
}>;

const isTextDelta = (part: Response.AnyPart): part is Response.TextDeltaPart =>
  part.type === "text-delta";

const event = (value: ChatEvent) => Stream.succeed(value);

export class GroundedChat extends Context.Service<
  GroundedChat,
  { stream(request: ChatRequest): Stream.Stream<ChatEvent> }
>()("rag-ai-chat/chat/GroundedChat") {
  static readonly layer = (plan: ChatPlan) =>
    Layer.effect(
      GroundedChat,
      Effect.gen(function* () {
        const retriever = yield* Retriever;

        const answer = (prompt: ReturnType<typeof groundedPrompt>) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const model = yield* Model.ModelName;
              return LanguageModel.streamText({ prompt }).pipe(
                Stream.filter(isTextDelta),
                Stream.map((part) => ({ model, text: part.delta })),
              );
            }),
          ).pipe(
            Stream.withExecutionPlan(plan, {
              preventFallbackOnPartialStream: true,
            }),
          );

        const respond = Effect.fn("GroundedChat.stream")(function* (
          request: ChatRequest,
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
          stream: (request) => Stream.unwrap(respond(request)),
        });
      }),
    );
}

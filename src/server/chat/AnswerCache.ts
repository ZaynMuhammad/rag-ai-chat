import { createHmac, randomBytes } from "node:crypto";
import {
  Array as Arr,
  Cache,
  Context,
  type Duration,
  Effect,
  Exit,
  Layer,
  Metric,
  Option,
  Stream,
  SubscriptionRef,
} from "effect";
import { corpusVersion } from "@/server/corpus/CorpusVersion";
import type { Scope } from "@/server/games/Scope";
import type { ChatEvent, ChatRequest } from "./ChatProtocol";
import { GroundedChat } from "./GroundedChat";

export const normalizeQuestion = (question: string) =>
  question
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/(\p{P})\1+/gu, "$1")
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "");

const canonicalScope = (scope: Scope) =>
  Object.entries(scope).toSorted(([a], [b]) => (a < b ? -1 : 1));

export interface AnswerKeyParts {
  readonly secret: Uint8Array;
  readonly corpusVersion: string;
  readonly models: ReadonlyArray<string>;
}

export const answerKey = (
  parts: AnswerKeyParts,
  model: string,
  request: ChatRequest,
): Option.Option<string> => {
  const [question, ...history] = request.messages;
  if (question?.role !== "user" || history.length > 0) return Option.none();
  const material = JSON.stringify([
    parts.corpusVersion,
    parts.models,
    model,
    canonicalScope(request.scope),
    normalizeQuestion(question.content),
  ]);
  return Option.some(
    createHmac("sha256", parts.secret).update(material).digest("base64url"),
  );
};

export type CacheResult = "hit" | "miss" | "coalesced" | "uncacheable";

const cacheRequests = Metric.counter("answer_cache_requests_total", {
  description:
    "Chat requests by answer cache result: hit, miss, coalesced onto an answer still streaming, or uncacheable (the chat has history)",
  incremental: true,
});

const countCacheResult = (result: CacheResult) =>
  Metric.update(Metric.withAttributes(cacheRequests, { result }), 1);

interface Progress {
  readonly events: ReadonlyArray<ChatEvent>;
  readonly exit: Exit.Exit<void> | undefined;
}

interface Flight {
  readonly leader: symbol;
  readonly progress: SubscriptionRef.SubscriptionRef<Progress>;
}

interface Question {
  readonly answer: Stream.Stream<ChatEvent>;
  readonly model: string;
}

class Asking extends Context.Service<
  Asking,
  Question & { readonly leader: symbol }
>()("rag-ai-chat/chat/AnswerCache/Asking") {}

const isCompleteAnswer = ({ events, exit }: Progress, primaryModel: string) => {
  const last = events.at(-1);
  return (
    exit !== undefined &&
    Exit.isSuccess(exit) &&
    last?._tag === "Done" &&
    (last.model === null || last.model === primaryModel) &&
    !events.some((event) => event._tag === "Failed")
  );
};

const replay = (progress: SubscriptionRef.SubscriptionRef<Progress>) =>
  SubscriptionRef.changes(progress).pipe(
    Stream.takeUntil((state) => state.exit !== undefined),
    Stream.mapAccum(
      () => 0,
      (sent, state) => [state.events.length, state.events.slice(sent)] as const,
    ),
    Stream.concat(
      Stream.unwrap(
        Effect.map(SubscriptionRef.get(progress), ({ exit }) =>
          exit === undefined || Exit.isSuccess(exit)
            ? Stream.empty
            : Stream.failCause(exit.cause),
        ),
      ),
    ),
  );

export interface AnswerCacheOptions {
  readonly capacity: number;
  readonly timeToLive: Duration.Input;
}

export const answerCacheDefaults = {
  capacity: 1000,
  timeToLive: "10 minutes",
} satisfies AnswerCacheOptions;

export const answerCacheLayer = (options: AnswerCacheOptions) =>
  Layer.effect(
    GroundedChat,
    Effect.gen(function* () {
      const upstream = yield* GroundedChat;
      const layerScope = yield* Effect.scope;
      const models = Arr.map(upstream.models, ({ id }) => id);
      const defaultModel = Arr.headNonEmpty(models);
      const keyParts: AnswerKeyParts = {
        secret: randomBytes(32),
        corpusVersion: yield* corpusVersion,
        models,
      };

      const finish = Effect.fn("AnswerCache.finish")(function* (
        key: string,
        flight: Flight,
        model: string,
        exit: Exit.Exit<void>,
      ) {
        const { events } = yield* SubscriptionRef.get(flight.progress);
        const finished = { events, exit };
        if (!isCompleteAnswer(finished, model)) {
          yield* Cache.invalidateWhen(
            answers,
            key,
            (cached) => cached === flight,
          );
        }
        yield* SubscriptionRef.set(flight.progress, finished);
      });

      const startFlight = Effect.fn("AnswerCache.startFlight")(function* (
        key: string,
      ) {
        const { answer, model, leader } = yield* Asking;
        const progress = yield* SubscriptionRef.make<Progress>({
          events: [],
          exit: undefined,
        });
        const flight: Flight = { leader, progress };
        yield* answer.pipe(
          Stream.runForEach((event) =>
            SubscriptionRef.update(progress, (state) => ({
              ...state,
              events: [...state.events, event],
            })),
          ),
          Effect.onExit((exit) =>
            finish(key, flight, model, Exit.asVoid(exit)),
          ),
          Effect.forkIn(layerScope),
        );
        return flight;
      });

      const answers: Cache.Cache<string, Flight, never, Asking> =
        yield* Cache.make({
          capacity: options.capacity,
          timeToLive: options.timeToLive,
          lookup: startFlight,
          requireServicesAt: "lookup",
        });

      const join = Effect.fn("AnswerCache.join")(function* (
        key: string,
        question: Question,
      ) {
        const leader = Symbol();
        const flight = yield* Cache.get(answers, key).pipe(
          Effect.provideService(Asking, { ...question, leader }),
        );
        const { exit } = yield* SubscriptionRef.get(flight.progress);
        yield* countCacheResult(
          flight.leader === leader
            ? "miss"
            : exit === undefined
              ? "coalesced"
              : "hit",
        );
        return replay(flight.progress);
      });

      return GroundedChat.of({
        models: upstream.models,
        stream: (request) =>
          Effect.map(upstream.stream(request), (answer) => {
            const model = request.model ?? defaultModel;
            return Option.match(answerKey(keyParts, model, request), {
              onNone: () =>
                Stream.unwrap(
                  Effect.as(countCacheResult("uncacheable"), answer),
                ),
              onSome: (key) => Stream.unwrap(join(key, { answer, model })),
            });
          }),
      });
    }),
  );

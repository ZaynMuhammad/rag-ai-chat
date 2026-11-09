import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Ref,
  Schema,
  Stream,
} from "effect";

export class CircuitOpen extends Schema.TaggedError<CircuitOpen>()(
  "CircuitOpen",
  { provider: Schema.String },
) {}

export interface BreakerPolicy {
  readonly consecutiveFailures: number;
  readonly failureRatio: number;
  readonly minimumCalls: number;
  readonly window: Duration.Input;
  readonly cooldown: Duration.Input;
}

export const defaultBreakerPolicy: BreakerPolicy = {
  consecutiveFailures: 5,
  failureRatio: 0.5,
  minimumCalls: 10,
  window: "30 seconds",
  cooldown: "10 seconds",
};

interface Call {
  readonly at: number;
  readonly failed: boolean;
}

type BreakerState =
  | {
      readonly _tag: "Closed";
      readonly consecutiveFailures: number;
      readonly recent: ReadonlyArray<Call>;
    }
  | { readonly _tag: "Open"; readonly until: number }
  | { readonly _tag: "HalfOpen"; readonly probing: boolean };

export type BreakerStatus = "closed" | "open" | "half-open";

type Admission = "call" | "probe" | "reject";
type Outcome = "success" | "failure" | "abandoned";

const closed: BreakerState = {
  _tag: "Closed",
  consecutiveFailures: 0,
  recent: [],
};

const admit = (
  state: BreakerState,
  now: number,
): readonly [Admission, BreakerState] => {
  switch (state._tag) {
    case "Closed":
      return ["call", state];
    case "Open":
      return now < state.until
        ? ["reject", state]
        : ["probe", { _tag: "HalfOpen", probing: true }];
    case "HalfOpen":
      return state.probing
        ? ["reject", state]
        : ["probe", { _tag: "HalfOpen", probing: true }];
  }
};

const settle = (
  policy: BreakerPolicy,
  state: BreakerState,
  admission: Admission,
  outcome: Outcome,
  now: number,
): BreakerState => {
  const open: BreakerState = {
    _tag: "Open",
    until: now + Duration.toMillis(policy.cooldown),
  };
  if (admission === "probe") {
    if (state._tag !== "HalfOpen") return state;
    if (outcome === "success") return closed;
    if (outcome === "failure") return open;
    return { _tag: "HalfOpen", probing: false };
  }
  if (state._tag !== "Closed" || outcome === "abandoned") return state;
  const failed = outcome === "failure";
  const windowStart = now - Duration.toMillis(policy.window);
  const recent = [
    ...state.recent.filter((call) => call.at > windowStart),
    { at: now, failed },
  ];
  const consecutiveFailures = failed ? state.consecutiveFailures + 1 : 0;
  const failures = recent.filter((call) => call.failed).length;
  const tripped =
    consecutiveFailures >= policy.consecutiveFailures ||
    (recent.length >= policy.minimumCalls &&
      failures / recent.length >= policy.failureRatio);
  return tripped ? open : { _tag: "Closed", consecutiveFailures, recent };
};

const statusOf = (state: BreakerState): BreakerStatus =>
  state._tag === "Closed"
    ? "closed"
    : state._tag === "Open"
      ? "open"
      : "half-open";

const outcomeOf = <E>(exit: Exit.Exit<unknown, E>): Outcome =>
  Exit.isSuccess(exit)
    ? "success"
    : Cause.hasInterruptsOnly(exit.cause)
      ? "abandoned"
      : "failure";

export class CircuitBreaker extends Context.Service<
  CircuitBreaker,
  {
    guard(
      provider: string,
    ): <A, E, R>(
      stream: Stream.Stream<A, E, R>,
    ) => Stream.Stream<A, E | CircuitOpen, R>;
    status(provider: string): Effect.Effect<BreakerStatus>;
  }
>()("rag-ai-chat/provider/CircuitBreaker") {
  static readonly make = (policy: BreakerPolicy) =>
    Effect.gen(function* () {
      const states = yield* Ref.make<ReadonlyMap<string, BreakerState>>(
        new Map(),
      );

      const transition = <A>(
        provider: string,
        step: (state: BreakerState, now: number) => readonly [A, BreakerState],
      ) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const [result, before, after] = yield* Ref.modify(states, (map) => {
            const state = map.get(provider) ?? closed;
            const [result, next] = step(state, now);
            return [
              [result, statusOf(state), statusOf(next)] as const,
              new Map(map).set(provider, next),
            ];
          });
          if (before !== after) {
            const log = after === "open" ? Effect.logWarning : Effect.logInfo;
            yield* log(`circuit ${after}`).pipe(
              Effect.annotateLogs({ provider }),
            );
          }
          return result;
        });

      const guard =
        (provider: string) =>
        <A, E, R>(stream: Stream.Stream<A, E, R>) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const admission = yield* transition(provider, admit);
              if (admission === "reject") {
                return yield* new CircuitOpen({ provider });
              }
              return stream.pipe(
                Stream.onExit((exit) =>
                  transition(provider, (state, now) => [
                    undefined,
                    settle(policy, state, admission, outcomeOf(exit), now),
                  ]),
                ),
              );
            }),
          );

      const status = (provider: string) =>
        Effect.map(Ref.get(states), (map) =>
          statusOf(map.get(provider) ?? closed),
        );

      return CircuitBreaker.of({ guard, status });
    });

  static readonly layer = Layer.effect(
    CircuitBreaker,
    CircuitBreaker.make(defaultBreakerPolicy),
  );
}

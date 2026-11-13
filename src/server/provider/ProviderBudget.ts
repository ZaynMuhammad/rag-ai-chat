import { Clock, Context, Duration, Effect, Ref, Schema } from "effect";

export class BudgetExhausted extends Schema.TaggedError<BudgetExhausted>()(
  "BudgetExhausted",
  {},
) {}

export interface BudgetLimit {
  readonly unit: "requests" | "tokens";
  readonly limit: number;
  readonly window: Duration.Input;
}

export interface Budget {
  reserve(
    promptTokens: number,
  ): Effect.Effect<Effect.Effect<void>, BudgetExhausted>;
}

interface Bucket extends BudgetLimit {
  readonly available: number;
}

interface BudgetState {
  readonly at: number;
  readonly buckets: ReadonlyArray<Bucket>;
}

const costOf = (bucket: BudgetLimit, tokens: number) =>
  bucket.unit === "requests" ? 1 : tokens;

const refilled = (state: BudgetState, now: number): BudgetState => {
  const elapsed = Math.max(0, now - state.at);
  return {
    at: Math.max(now, state.at),
    buckets: state.buckets.map((bucket) => ({
      ...bucket,
      available: Math.min(
        bucket.limit,
        bucket.available +
          (elapsed * bucket.limit) / Duration.toMillis(bucket.window),
      ),
    })),
  };
};

const affords = (state: BudgetState, tokens: number) =>
  state.buckets.every((bucket) => bucket.available >= costOf(bucket, tokens));

const spent = (state: BudgetState, tokens: number): BudgetState => ({
  ...state,
  buckets: state.buckets.map((bucket) => ({
    ...bucket,
    available: bucket.available - costOf(bucket, tokens),
  })),
});

const refunded = (state: BudgetState, tokens: number): BudgetState => ({
  ...state,
  buckets: state.buckets.map((bucket) => ({
    ...bucket,
    available: Math.min(
      bucket.limit,
      bucket.available + costOf(bucket, tokens),
    ),
  })),
});

export class ProviderBudget extends Context.Service<ProviderBudget, Budget>()(
  "rag-ai-chat/provider/ProviderBudget",
) {
  static readonly unlimited: Budget = {
    reserve: () => Effect.succeed(Effect.void),
  };

  static readonly make = (
    limits: ReadonlyArray<BudgetLimit>,
    answerTokens: number,
  ) =>
    Effect.gen(function* () {
      const state = yield* Ref.make<BudgetState>({
        at: yield* Clock.currentTimeMillis,
        buckets: limits.map((limit) => ({ ...limit, available: limit.limit })),
      });

      const reserve = Effect.fn("ProviderBudget.reserve")(function* (
        promptTokens: number,
      ) {
        const tokens = promptTokens + answerTokens;
        const now = yield* Clock.currentTimeMillis;
        const admitted = yield* Ref.modify(state, (before) => {
          const current = refilled(before, now);
          return affords(current, tokens)
            ? [true, spent(current, tokens)]
            : [false, current];
        });
        if (!admitted) return yield* new BudgetExhausted();
        return Ref.update(state, (current) => refunded(current, tokens));
      });

      return ProviderBudget.of({ reserve });
    });
}

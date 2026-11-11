import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { BudgetExhausted, ProviderBudget } from "./ProviderBudget";

const admitted = (reservation: Effect.Effect<unknown, BudgetExhausted>) =>
  Effect.asVoid(reservation);

const refused = (reservation: Effect.Effect<unknown, BudgetExhausted>) =>
  Effect.map(Effect.flip(reservation), (error) => {
    assert.instanceOf(error, BudgetExhausted);
  });

describe("ProviderBudget", () => {
  it.effect(
    "counts the prompt and the answer allowance against the token limit, and refills over time",
    () =>
      Effect.gen(function* () {
        const budget = yield* ProviderBudget.make(
          [{ unit: "tokens", limit: 1000, window: "1 minute" }],
          200,
        );
        yield* admitted(budget.reserve(300));
        yield* admitted(budget.reserve(300));
        yield* refused(budget.reserve(300));

        yield* TestClock.adjust("29 seconds");
        yield* refused(budget.reserve(300));
        yield* TestClock.adjust("1 second");
        yield* admitted(budget.reserve(300));
      }),
  );

  it.effect("counts each call once against the request limit", () =>
    Effect.gen(function* () {
      const budget = yield* ProviderBudget.make(
        [{ unit: "requests", limit: 2, window: "1 day" }],
        200,
      );
      yield* admitted(budget.reserve(5000));
      yield* admitted(budget.reserve(5000));
      yield* refused(budget.reserve(1));

      yield* TestClock.adjust("12 hours");
      yield* admitted(budget.reserve(1));
      yield* refused(budget.reserve(1));
    }),
  );

  it.effect("never holds more than the limit, however long it sits idle", () =>
    Effect.gen(function* () {
      const budget = yield* ProviderBudget.make(
        [{ unit: "requests", limit: 2, window: "1 minute" }],
        0,
      );
      yield* TestClock.adjust("1 hour");
      yield* admitted(budget.reserve(1));
      yield* admitted(budget.reserve(1));
      yield* refused(budget.reserve(1));
    }),
  );

  it.effect("a call refused by one limit spends nothing from the others", () =>
    Effect.gen(function* () {
      const budget = yield* ProviderBudget.make(
        [
          { unit: "requests", limit: 1, window: "1 minute" },
          { unit: "tokens", limit: 250, window: "1 day" },
        ],
        0,
      );
      yield* admitted(budget.reserve(100));
      yield* refused(budget.reserve(100));
      yield* refused(budget.reserve(100));

      yield* TestClock.adjust("1 minute");
      yield* admitted(budget.reserve(100));
    }),
  );

  it.effect("a refund returns what the call reserved", () =>
    Effect.gen(function* () {
      const budget = yield* ProviderBudget.make(
        [
          { unit: "requests", limit: 1, window: "1 day" },
          { unit: "tokens", limit: 500, window: "1 day" },
        ],
        200,
      );
      const refund = yield* budget.reserve(300);
      yield* refused(budget.reserve(300));
      yield* refund;
      yield* admitted(budget.reserve(300));
    }),
  );
});

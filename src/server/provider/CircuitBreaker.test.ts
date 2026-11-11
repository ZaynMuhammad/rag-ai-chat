import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  type BreakerPolicy,
  CircuitBreaker,
  CircuitOpen,
} from "./CircuitBreaker";

const policy: BreakerPolicy = {
  consecutiveFailures: 3,
  failureRatio: 0.5,
  minimumCalls: 6,
  window: "30 seconds",
  cooldown: "10 seconds",
};

const breaker = Layer.effect(CircuitBreaker, CircuitBreaker.make(policy));

const provider = "test-model";

const callsMade = Effect.map(Ref.make(0), (calls) => ({
  calls,
  answer: (ok: boolean) =>
    Stream.fromEffect(Ref.update(calls, (n) => n + 1)).pipe(
      Stream.flatMap(() => (ok ? Stream.make("token") : Stream.fail("down"))),
    ),
}));

const call = (stream: Stream.Stream<string, string>) =>
  Effect.flatMap(CircuitBreaker, (b) =>
    stream.pipe(b.guard(provider), Stream.runDrain, Effect.flip, Effect.option),
  );

const status = Effect.flatMap(CircuitBreaker, (b) => b.status(provider));

describe("CircuitBreaker", () => {
  it.effect(
    "opens after consecutive failures and then rejects without calling the provider",
    () =>
      Effect.gen(function* () {
        const { calls, answer } = yield* callsMade;
        yield* call(answer(false));
        yield* call(answer(false));
        assert.strictEqual(yield* status, "closed");
        yield* call(answer(false));
        assert.strictEqual(yield* status, "open");
        const rejected = yield* call(answer(true));
        assert.deepStrictEqual(rejected._tag, "Some");
        assert.instanceOf(
          rejected._tag === "Some" ? rejected.value : undefined,
          CircuitOpen,
        );
        assert.strictEqual(yield* Ref.get(calls), 3);
      }).pipe(Effect.provide(breaker)),
  );

  it.effect("resets the consecutive count on a success", () =>
    Effect.gen(function* () {
      const { answer } = yield* callsMade;
      for (const ok of [false, false, true, false, false]) {
        yield* call(answer(ok));
      }
      assert.strictEqual(yield* status, "closed");
    }).pipe(Effect.provide(breaker)),
  );

  it.effect(
    "opens when half the calls in the window fail, and forgets calls older than the window",
    () =>
      Effect.gen(function* () {
        const { answer } = yield* callsMade;
        for (const ok of [false, true, false, true, false]) {
          yield* call(answer(ok));
        }
        yield* TestClock.adjust("31 seconds");
        for (const ok of [false, true, false, true, false]) {
          yield* call(answer(ok));
        }
        assert.strictEqual(yield* status, "closed");
        yield* call(answer(true));
        assert.strictEqual(yield* status, "open");
      }).pipe(Effect.provide(breaker)),
  );

  it.effect(
    "lets one probe through after the cooldown, and closes when it succeeds",
    () =>
      Effect.gen(function* () {
        const { calls, answer } = yield* callsMade;
        for (let i = 0; i < 3; i++) yield* call(answer(false));
        yield* TestClock.adjust("9 seconds");
        yield* call(answer(true));
        assert.strictEqual(yield* Ref.get(calls), 3);

        yield* TestClock.adjust("1 second");
        const release = yield* Deferred.make<string>();
        const probe = yield* call(
          answer(true).pipe(
            Stream.concat(Stream.fromEffect(Deferred.await(release))),
          ),
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        assert.strictEqual(yield* status, "half-open");
        const meanwhile = yield* call(answer(true));
        assert.strictEqual(meanwhile._tag, "Some");
        assert.strictEqual(yield* Ref.get(calls), 4);

        yield* Deferred.succeed(release, "token");
        yield* Fiber.join(probe);
        assert.strictEqual(yield* status, "closed");
        assert.strictEqual((yield* call(answer(true)))._tag, "None");
      }).pipe(Effect.provide(breaker)),
  );

  it.effect("reopens for another cooldown when the probe fails", () =>
    Effect.gen(function* () {
      const { answer } = yield* callsMade;
      for (let i = 0; i < 3; i++) yield* call(answer(false));
      yield* TestClock.adjust("10 seconds");
      yield* call(answer(false));
      assert.strictEqual(yield* status, "open");
      yield* TestClock.adjust("9 seconds");
      assert.strictEqual((yield* call(answer(true)))._tag, "Some");
      yield* TestClock.adjust("1 second");
      assert.strictEqual((yield* call(answer(true)))._tag, "None");
      assert.strictEqual(yield* status, "closed");
    }).pipe(Effect.provide(breaker)),
  );

  it.effect(
    "frees the probe slot when the caller goes away mid-probe, without counting it",
    () =>
      Effect.gen(function* () {
        const { answer } = yield* callsMade;
        for (let i = 0; i < 3; i++) yield* call(answer(false));
        yield* TestClock.adjust("10 seconds");
        const abandoned = yield* call(Stream.never).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(abandoned);
        assert.strictEqual(yield* status, "half-open");
        assert.strictEqual((yield* call(answer(true)))._tag, "None");
        assert.strictEqual(yield* status, "closed");
      }).pipe(Effect.provide(breaker)),
  );

  it.effect("keeps each provider's state separate", () =>
    Effect.gen(function* () {
      const { answer } = yield* callsMade;
      for (let i = 0; i < 3; i++) yield* call(answer(false));
      const other = yield* Effect.flatMap(CircuitBreaker, (b) =>
        b.status("other-model"),
      );
      assert.strictEqual(other, "closed");
    }).pipe(Effect.provide(breaker)),
  );
});

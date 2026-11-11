import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Schema, Stream } from "effect";
import { LanguageModel } from "effect/ai";
import { TestClock } from "effect/testing";
import {
  MockProvider,
  MockSchedule,
  outageLatency,
  parseMockSchedule,
} from "./MockProvider";

const answerAt = (second: number) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(second * 1000);
    const fiber = yield* LanguageModel.streamText({
      prompt: "Who made Tetris?",
    }).pipe(Stream.runDrain, Effect.result, Effect.forkChild);
    yield* TestClock.adjust(outageLatency);
    yield* TestClock.adjust("2 seconds");
    return yield* Fiber.join(fiber);
  });

describe("MockProvider.primary", () => {
  it.effect(
    "follows its schedule from the first call, then keeps the last mode",
    () =>
      Effect.gen(function* () {
        const model = yield* MockProvider.primary(
          parseMockSchedule("ok@10,outage@10,ok"),
        );
        const outcomes: Array<string> = [];
        for (const second of [0, 5, 10, 15, 20, 25]) {
          const result = yield* Effect.provide(answerAt(second), model);
          outcomes.push(result._tag);
        }
        assert.deepStrictEqual(outcomes, [
          "Success",
          "Success",
          "Failure",
          "Failure",
          "Success",
          "Success",
        ]);
      }),
  );

  it("accepts mode lists and rejects anything else", () => {
    const valid = Schema.is(MockSchedule);
    assert.isTrue(valid("hang"));
    assert.isTrue(valid("ok@15,hang@15,outage@15,ok"));
    assert.isTrue(valid("flaky:0.25"));
    assert.isFalse(valid("flaky:2"));
    assert.isFalse(valid("down"));
    assert.isFalse(valid("ok@,hang"));
    assert.deepStrictEqual(parseMockSchedule("flaky:0.25@20,slow"), [
      { mode: { _tag: "flaky", failureRate: 0.25 }, seconds: 20 },
      { mode: { _tag: "slow" }, seconds: undefined },
    ]);
  });
});

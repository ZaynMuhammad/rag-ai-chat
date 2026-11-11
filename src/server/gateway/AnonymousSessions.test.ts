import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { RateLimiter } from "effect/persistence";
import { TestClock } from "effect/testing";
import {
  AnonymousSessions,
  InvalidSession,
  RateLimited,
  type SessionPolicy,
  type TierLimits,
} from "./AnonymousSessions";

const policy: SessionPolicy = {
  lifetime: "30 minutes",
  issuance: { limit: 3, window: "1 minute" },
  chatPerSession: { limit: 2, window: "1 minute" },
  chatOverall: { limit: 3, window: "1 minute" },
};

const sessions = Layer.effect(
  AnonymousSessions,
  AnonymousSessions.make(policy),
).pipe(
  Layer.provide(RateLimiter.layer),
  Layer.provide(RateLimiter.layerStoreMemory),
);

const issue = Effect.flatMap(AnonymousSessions, (s) => s.issue);
const admit = (token: string | null) =>
  Effect.flatMap(AnonymousSessions, (s) => s.admitChat(token));

describe("AnonymousSessions", () => {
  it.effect("admits a chat with a token it issued", () =>
    Effect.gen(function* () {
      const { token } = yield* issue;
      yield* admit(token);
    }).pipe(Effect.provide(sessions)),
  );

  it.effect("rejects a missing, forged, or tampered token", () =>
    Effect.gen(function* () {
      const { token } = yield* issue;
      const [version, id, expiresAt, signature] = token.split(".");
      const extended = `${version}.${id}.${Number(expiresAt) * 2}.${signature}`;
      for (const bad of [
        null,
        "",
        "v1.abc.9999999999999.c2ln",
        extended,
        `${token}.x`,
      ]) {
        assert.deepStrictEqual(
          yield* Effect.flip(admit(bad)),
          new InvalidSession(),
        );
      }
    }).pipe(Effect.provide(sessions)),
  );

  it.effect("rejects a token once it expires, so sessions rotate", () =>
    Effect.gen(function* () {
      const { token } = yield* issue;
      yield* TestClock.adjust("29 minutes");
      yield* admit(token);
      yield* TestClock.adjust("1 minute");
      assert.deepStrictEqual(
        yield* Effect.flip(admit(token)),
        new InvalidSession(),
      );
    }).pipe(Effect.provide(sessions)),
  );

  it.effect("limits each session on its own and refills over time", () =>
    Effect.gen(function* () {
      const first = yield* issue;
      const second = yield* issue;
      yield* admit(first.token);
      yield* admit(first.token);
      const limited = yield* Effect.flip(admit(first.token));
      assert.instanceOf(limited, RateLimited);
      assert.isAtLeast(limited.retryAfterSeconds, 1);
      yield* admit(second.token);
      yield* TestClock.adjust("1 minute");
      yield* admit(first.token);
    }).pipe(Effect.provide(sessions)),
  );

  it.effect(
    "caps chats across all sessions, so minting tokens can't lift the limit",
    () =>
      Effect.gen(function* () {
        const tokens = yield* Effect.all([issue, issue, issue]);
        for (const { token } of tokens) yield* admit(token);
        const fourth = yield* Effect.flip(admit(tokens[0].token));
        assert.instanceOf(fourth, RateLimited);
      }).pipe(Effect.provide(sessions)),
  );

  it.effect("caps how fast new sessions can be minted", () =>
    Effect.gen(function* () {
      yield* Effect.all([issue, issue, issue]);
      assert.instanceOf(yield* Effect.flip(issue), RateLimited);
    }).pipe(Effect.provide(sessions)),
  );
});

const proLimits: TierLimits = {
  chatPerSession: { limit: 4, window: "1 minute" },
  chatOverall: { limit: 5, window: "1 minute" },
};

const tiered = Layer.effect(
  AnonymousSessions,
  AnonymousSessions.make(policy, proLimits),
).pipe(
  Layer.provide(RateLimiter.layer),
  Layer.provide(RateLimiter.layerStoreMemory),
);

const issuePro = Effect.flatMap(AnonymousSessions, (s) => s.issuePro);

describe("AnonymousSessions tiers", () => {
  it.effect(
    "gives a pro session pro limits and a free session free limits",
    () =>
      Effect.gen(function* () {
        const free = yield* issue;
        const pro = yield* issuePro;
        assert.strictEqual(free.tier, "free");
        assert.strictEqual(pro.tier, "pro");
        for (let i = 0; i < 4; i++) yield* admit(pro.token);
        assert.instanceOf(yield* Effect.flip(admit(pro.token)), RateLimited);
        yield* admit(free.token);
        yield* admit(free.token);
        assert.instanceOf(yield* Effect.flip(admit(free.token)), RateLimited);
      }).pipe(Effect.provide(tiered)),
  );

  it.effect(
    "caps pro chats with their own global limit, apart from free chats",
    () =>
      Effect.gen(function* () {
        for (const { token } of yield* Effect.all([issue, issue, issue])) {
          yield* admit(token);
        }
        const [first, second] = yield* Effect.all([issuePro, issuePro]);
        for (let i = 0; i < 4; i++) yield* admit(first.token);
        yield* admit(second.token);
        assert.instanceOf(yield* Effect.flip(admit(second.token)), RateLimited);
      }).pipe(Effect.provide(tiered)),
  );

  it.effect("rejects a free token relabelled as pro", () =>
    Effect.gen(function* () {
      const { token } = yield* issue;
      const cut = token.lastIndexOf(".");
      assert.deepStrictEqual(
        yield* Effect.flip(
          admit(`${token.slice(0, cut)}.pro${token.slice(cut)}`),
        ),
        new InvalidSession(),
      );
    }).pipe(Effect.provide(tiered)),
  );
});

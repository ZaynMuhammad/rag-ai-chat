import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  Clock,
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { RateLimiter } from "effect/persistence";
import type { IssuedSession } from "./SessionProtocol";

export class InvalidSession extends Schema.TaggedError<InvalidSession>()(
  "InvalidSession",
  {},
) {}

export class RateLimited extends Schema.TaggedError<RateLimited>()(
  "RateLimited",
  { retryAfterSeconds: Schema.Number },
) {}

export interface Limit {
  readonly limit: number;
  readonly window: Duration.Input;
}

export interface SessionPolicy {
  readonly lifetime: Duration.Input;
  readonly issuance: Limit;
  readonly chatPerSession: Limit;
  readonly chatOverall: Limit;
}

export const defaultPolicy: SessionPolicy = {
  lifetime: "30 minutes",
  issuance: { limit: 120, window: "1 minute" },
  chatPerSession: { limit: 10, window: "1 minute" },
  chatOverall: { limit: 600, window: "1 minute" },
};

const tokenVersion = "v1";

const signature = (secret: Uint8Array, payload: string) =>
  createHmac("sha256", secret).update(payload).digest();

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && timingSafeEqual(a, b);

export class AnonymousSessions extends Context.Service<
  AnonymousSessions,
  {
    readonly issue: Effect.Effect<IssuedSession, RateLimited>;
    admitChat(
      token: string | null,
    ): Effect.Effect<void, InvalidSession | RateLimited>;
  }
>()("rag-ai-chat/gateway/AnonymousSessions") {
  static readonly make = (policy: SessionPolicy) =>
    Effect.gen(function* () {
      const limiter = yield* RateLimiter.RateLimiter;
      const configuredSecret = yield* Config.option(
        Config.Redacted("SESSION_SECRET"),
      );
      const secret = Option.match(configuredSecret, {
        onNone: () => randomBytes(32),
        onSome: (value) => Buffer.from(Redacted.value(value)),
      });

      const consume = (key: string, { limit, window }: Limit) =>
        limiter
          .consume({
            algorithm: "token-bucket",
            onExceeded: "fail",
            key,
            limit,
            window,
          })
          .pipe(
            Effect.catchTag("RateLimiterError", (error) =>
              error.reason._tag === "RateLimitExceeded"
                ? Effect.fail(
                    new RateLimited({
                      retryAfterSeconds: Math.max(
                        1,
                        Math.ceil(Duration.toSeconds(error.reason.retryAfter)),
                      ),
                    }),
                  )
                : Effect.die(error),
            ),
          );

      const issue = Effect.gen(function* () {
        yield* consume("issue", policy.issuance);
        const expiresAt =
          (yield* Clock.currentTimeMillis) + Duration.toMillis(policy.lifetime);
        const payload = `${tokenVersion}.${randomBytes(16).toString("base64url")}.${expiresAt}`;
        return {
          token: `${payload}.${signature(secret, payload).toString("base64url")}`,
          expiresAt,
        };
      }).pipe(Effect.withSpan("AnonymousSessions.issue"));

      const sessionId = Effect.fn("AnonymousSessions.sessionId")(function* (
        token: string | null,
      ) {
        const [version, id, expiresAt, signed, ...rest] = (token ?? "").split(
          ".",
        );
        if (
          version !== tokenVersion ||
          id === undefined ||
          expiresAt === undefined ||
          signed === undefined ||
          rest.length > 0 ||
          !sameBytes(
            Buffer.from(signed, "base64url"),
            signature(secret, `${version}.${id}.${expiresAt}`),
          ) ||
          Number(expiresAt) <= (yield* Clock.currentTimeMillis)
        ) {
          return yield* new InvalidSession();
        }
        return id;
      });

      const admitChat = Effect.fn("AnonymousSessions.admitChat")(function* (
        token: string | null,
      ) {
        const id = yield* sessionId(token);
        yield* consume(`session:${id}`, policy.chatPerSession);
        yield* consume("chat", policy.chatOverall);
      });

      return AnonymousSessions.of({ issue, admitChat });
    });

  static readonly layer = Layer.effect(
    AnonymousSessions,
    AnonymousSessions.make(defaultPolicy),
  ).pipe(
    Layer.provide(RateLimiter.layer),
    Layer.provide(RateLimiter.layerStoreMemory),
  );
}

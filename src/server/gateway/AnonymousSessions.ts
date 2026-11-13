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
import type { IssuedSession, Tier } from "./SessionProtocol";

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

export interface TierLimits {
  readonly chatPerSession: Limit;
  readonly chatOverall: Limit;
}

export interface SessionPolicy extends TierLimits {
  readonly lifetime: Duration.Input;
  readonly issuance: Limit;
  readonly search: Limit;
}

export const defaultPolicy: SessionPolicy = {
  lifetime: "30 minutes",
  issuance: { limit: 120, window: "1 minute" },
  chatPerSession: { limit: 10, window: "1 minute" },
  chatOverall: { limit: 240, window: "1 minute" },
  search: { limit: 5, window: "15 seconds" },
};

export const defaultProLimits: TierLimits = {
  chatPerSession: { limit: 60, window: "1 minute" },
  chatOverall: { limit: 1200, window: "1 minute" },
};

const tokenVersion = "v1";

const signature = (secret: Uint8Array, payload: string) =>
  createHmac("sha256", secret).update(payload).digest();

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && timingSafeEqual(a, b);

export const consumeWith =
  (limiter: RateLimiter.RateLimiter) =>
  (key: string, { limit, window }: Limit, tokens = 1) =>
    limiter
      .consume({
        algorithm: "token-bucket",
        onExceeded: "fail",
        key,
        limit,
        window,
        tokens,
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

export class AnonymousSessions extends Context.Service<
  AnonymousSessions,
  {
    readonly issue: Effect.Effect<IssuedSession, RateLimited>;
    readonly issuePro: Effect.Effect<IssuedSession>;
    readonly admitSearch: Effect.Effect<void, RateLimited>;
    admitChat(
      token: string | null,
    ): Effect.Effect<void, InvalidSession | RateLimited>;
  }
>()("rag-ai-chat/gateway/AnonymousSessions") {
  static readonly make = (
    policy: SessionPolicy,
    pro: TierLimits = defaultProLimits,
  ) =>
    Effect.gen(function* () {
      const limiter = yield* RateLimiter.RateLimiter;
      const configuredSecret = yield* Config.option(
        Config.Redacted("SESSION_SECRET"),
      );
      const secret = Option.match(configuredSecret, {
        onNone: () => randomBytes(32),
        onSome: (value) => Buffer.from(Redacted.value(value)),
      });

      const consume = consumeWith(limiter);
      const limits = { free: policy, pro } satisfies Record<Tier, TierLimits>;

      const mint = (tier: Tier) =>
        Effect.gen(function* () {
          const expiresAt =
            (yield* Clock.currentTimeMillis) +
            Duration.toMillis(policy.lifetime);
          const id = randomBytes(16).toString("base64url");
          const payload = `${tokenVersion}.${id}.${expiresAt}${tier === "pro" ? ".pro" : ""}`;
          return {
            token: `${payload}.${signature(secret, payload).toString("base64url")}`,
            expiresAt,
            tier,
          };
        });

      const issue = consume("issue", policy.issuance).pipe(
        Effect.andThen(mint("free")),
        Effect.withSpan("AnonymousSessions.issue"),
      );

      const issuePro = mint("pro").pipe(
        Effect.withSpan("AnonymousSessions.issuePro"),
      );

      const admitSearch = consume("search", policy.search).pipe(
        Effect.withSpan("AnonymousSessions.admitSearch"),
      );

      const session = Effect.fn("AnonymousSessions.session")(function* (
        token: string | null,
      ) {
        const value = token ?? "";
        const cut = value.lastIndexOf(".");
        const payload = value.slice(0, Math.max(cut, 0));
        const [version, id, expiresAt, tier, ...rest] = payload.split(".");
        if (
          cut < 0 ||
          !sameBytes(
            Buffer.from(value.slice(cut + 1), "base64url"),
            signature(secret, payload),
          ) ||
          version !== tokenVersion ||
          id === undefined ||
          expiresAt === undefined ||
          (tier !== undefined && tier !== "pro") ||
          rest.length > 0 ||
          Number(expiresAt) <= (yield* Clock.currentTimeMillis)
        ) {
          return yield* new InvalidSession();
        }
        return { id, tier: tier ?? "free" } as const;
      });

      const admitChat = Effect.fn("AnonymousSessions.admitChat")(function* (
        token: string | null,
      ) {
        const { id, tier } = yield* session(token);
        yield* consume(`session:${id}`, limits[tier].chatPerSession);
        yield* consume(`chat:${tier}`, limits[tier].chatOverall);
      });

      return AnonymousSessions.of({
        issue,
        issuePro,
        admitSearch,
        admitChat,
      });
    });

  static readonly layer = Layer.effect(
    AnonymousSessions,
    AnonymousSessions.make(defaultPolicy),
  ).pipe(
    Layer.provide(RateLimiter.layer),
    Layer.provide(RateLimiter.layerStoreMemory),
  );
}

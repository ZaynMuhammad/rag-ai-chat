import { createHash } from "node:crypto";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { RateLimiter } from "effect/persistence";
import { messageLength, verify } from "@/lib/blindRsa";
import {
  AnonymousSessions,
  consumeWith,
  type Limit,
  RateLimited,
} from "@/server/gateway/AnonymousSessions";
import type { IssuedSession } from "@/server/gateway/SessionProtocol";
import { Entitlements, type NotEntitled } from "./Entitlements";
import { blindSign } from "./blindSign";
import {
  configuredSigningKeys,
  type IssuerKey,
  prepareKey,
  type SigningKey,
} from "./IssuerKeys";
import type {
  Credential,
  IssueRequest,
  IssueResponse,
  PublishedKeys,
} from "./ProProtocol";

export class StaleKey extends Schema.TaggedError<StaleKey>()("StaleKey", {}) {}

export class InvalidBlindedMessage extends Schema.TaggedError<InvalidBlindedMessage>()(
  "InvalidBlindedMessage",
  {},
) {}

export class InvalidCredential extends Schema.TaggedError<InvalidCredential>()(
  "InvalidCredential",
  {},
) {}

export interface CredentialPolicy {
  readonly issuancePerEntitlement: Limit;
  readonly maxSpent: number;
}

export const defaultCredentialPolicy: CredentialPolicy = {
  issuancePerEntitlement: { limit: 50, window: "1 day" },
  maxSpent: 1_000_000,
};

const spentDigest = (message: Uint8Array) =>
  createHash("sha256").update(message).digest("base64url");

export class ProCredentials extends Context.Service<
  ProCredentials,
  {
    readonly keys: Effect.Effect<PublishedKeys>;
    issue(
      request: IssueRequest,
    ): Effect.Effect<
      IssueResponse,
      NotEntitled | StaleKey | RateLimited | InvalidBlindedMessage
    >;
    redeem(
      credential: Credential,
    ): Effect.Effect<IssuedSession, InvalidCredential | RateLimited>;
  }
>()("rag-ai-chat/pro/ProCredentials") {
  static readonly make = (
    signingKeys: ReadonlyArray<SigningKey>,
    policy: CredentialPolicy,
  ) =>
    Effect.gen(function* () {
      const entitlements = yield* Entitlements;
      const sessions = yield* AnonymousSessions;
      const consume = consumeWith(yield* RateLimiter.RateLimiter);
      const issuerKeys = yield* Effect.forEach(signingKeys, prepareKey);
      const spent = new Map<string, Set<string>>();

      const liveKeys = Effect.map(
        Clock.currentTimeMillis,
        (now): ReadonlyArray<IssuerKey> =>
          issuerKeys.filter((key) => key.expiresAt > now),
      );

      const keys = Effect.map(liveKeys, (live) => ({
        keys: live.map(({ id, spki, expiresAt }) => ({ id, spki, expiresAt })),
      }));

      const issue = Effect.fn("ProCredentials.issue")(function* (
        request: IssueRequest,
      ) {
        const entitlement = yield* entitlements.check(request.code);
        const [issuing] = yield* liveKeys;
        if (issuing === undefined || issuing.id !== request.keyId) {
          return yield* new StaleKey();
        }
        yield* consume(
          `pro-issue:${entitlement.id}`,
          policy.issuancePerEntitlement,
          request.blindedMessages.length,
        );
        const blindSignatures = yield* Effect.try({
          try: () =>
            request.blindedMessages.map((blinded) =>
              blindSign(issuing.privateKey, blinded),
            ),
          catch: () => new InvalidBlindedMessage(),
        });
        return { keyId: issuing.id, blindSignatures };
      });

      const markSpent = (key: IssuerKey, message: Uint8Array) =>
        Effect.gen(function* () {
          const live = new Set((yield* liveKeys).map(({ id }) => id));
          for (const id of spent.keys()) if (!live.has(id)) spent.delete(id);
          const forKey = spent.get(key.id) ?? new Set<string>();
          const digest = spentDigest(message);
          if (forKey.has(digest)) return yield* new InvalidCredential();
          const total = [...spent.values()].reduce((n, s) => n + s.size, 0);
          if (total >= policy.maxSpent) {
            return yield* new RateLimited({ retryAfterSeconds: 60 });
          }
          spent.set(key.id, forKey.add(digest));
        });

      const redeem = Effect.fn("ProCredentials.redeem")(function* (
        credential: Credential,
      ) {
        const key = (yield* liveKeys).find(({ id }) => id === credential.keyId);
        if (key === undefined || credential.message.length !== messageLength) {
          return yield* new InvalidCredential();
        }
        const valid = yield* Effect.tryPromise({
          try: () =>
            verify(
              key.publicKey,
              new Uint8Array(credential.message),
              new Uint8Array(credential.signature),
            ),
          catch: () => new InvalidCredential(),
        });
        if (!valid) return yield* new InvalidCredential();
        yield* markSpent(key, credential.message);
        return yield* sessions.issuePro;
      });

      return ProCredentials.of({ keys, issue, redeem });
    });

  static readonly layer = Layer.effect(
    ProCredentials,
    Effect.flatMap(configuredSigningKeys, (signingKeys) =>
      ProCredentials.make(signingKeys, defaultCredentialPolicy),
    ),
  ).pipe(
    Layer.provide(Entitlements.layer),
    Layer.provide(RateLimiter.layer),
    Layer.provide(RateLimiter.layerStoreMemory),
  );
}

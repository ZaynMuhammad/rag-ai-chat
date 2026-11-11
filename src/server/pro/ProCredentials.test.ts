import { constants, generateKeyPairSync, sign } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Layer, Schema } from "effect";
import { RateLimiter } from "effect/persistence";
import { TestClock } from "effect/testing";
import {
  bytesToInt,
  fromBase64Url,
  modInverse,
  modPow,
  randomMessage,
} from "@/lib/blindRsa";
import { prepareBatch } from "@/lib/proCredentials";
import {
  AnonymousSessions,
  defaultPolicy,
  RateLimited,
} from "@/server/gateway/AnonymousSessions";
import { Entitlements, NotEntitled } from "./Entitlements";
import type { SigningKey } from "./IssuerKeys";
import {
  type CredentialPolicy,
  InvalidCredential,
  ProCredentials,
  StaleKey,
} from "./ProCredentials";
import { type Credential, Credential as CredentialSchema } from "./ProProtocol";

const rsaKey = () =>
  generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const current = rsaKey();
const previous = rsaKey();
const outsider = rsaKey();
const day = Duration.toMillis(Duration.days(1));

const policy: CredentialPolicy = {
  issuancePerEntitlement: { limit: 6, window: "1 day" },
  maxSpent: 100,
};

const credentialsWith = (
  signingKeys: ReadonlyArray<SigningKey>,
  overrides: Partial<CredentialPolicy> = {},
) =>
  Layer.effect(
    ProCredentials,
    ProCredentials.make(signingKeys, { ...policy, ...overrides }),
  ).pipe(
    Layer.provideMerge(
      Layer.effect(AnonymousSessions, AnonymousSessions.make(defaultPolicy)),
    ),
    Layer.provide(Entitlements.accessCodes(["alice-code", "bob-code"])),
    Layer.provide(RateLimiter.layer),
    Layer.provide(RateLimiter.layerStoreMemory),
  );

const oneKey = credentialsWith([{ privateKey: current, expiresAt: 2 * day }]);

const issuingKey = Effect.gen(function* () {
  const { keys } = yield* Effect.flatMap(ProCredentials, (c) => c.keys);
  const [published] = keys;
  assert.isDefined(published);
  return published;
});

const obtain = (code: string, count = 1) =>
  Effect.gen(function* () {
    const published = yield* issuingKey;
    const batch = yield* Effect.promise(() => prepareBatch(published, count));
    const request = {
      code,
      keyId: published.id,
      blindedMessages: batch.blindedMessages,
    };
    const issued = yield* Effect.flatMap(ProCredentials, (c) =>
      c.issue(request),
    );
    const credentials = yield* Effect.promise(() =>
      batch.finalize(issued.blindSignatures),
    );
    return { request, issued, credentials };
  });

const redeem = (credential: Credential | undefined) =>
  Effect.flatMap(ProCredentials, (c) => {
    assert.isDefined(credential);
    return c.redeem(credential);
  });

const admit = (token: string) =>
  Effect.flatMap(AnonymousSessions, (s) => s.admitChat(token));

const signedBy = (privateKey: typeof current, keyId: string): Credential => {
  const message = randomMessage();
  return {
    keyId,
    message,
    signature: new Uint8Array(
      sign("sha384", message, {
        key: privateKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 48,
      }),
    ),
  };
};

describe("ProCredentials", () => {
  it.effect(
    "issues a batch whose credentials each redeem for a pro session",
    () =>
      Effect.gen(function* () {
        const { credentials } = yield* obtain("alice-code", 3);
        assert.lengthOf(credentials, 3);
        for (const credential of credentials) {
          const session = yield* redeem(credential);
          assert.strictEqual(session.tier, "pro");
          yield* admit(session.token);
        }
      }).pipe(Effect.provide(oneKey)),
  );

  it.effect("rejects a forged, tampered, or wrong-key credential", () =>
    Effect.gen(function* () {
      const [credential] = (yield* obtain("alice-code")).credentials;
      assert.isDefined(credential);
      const tampered = new Uint8Array(credential.message);
      tampered[0] = (tampered[0] ?? 0) ^ 1;
      const forgeries: ReadonlyArray<Credential> = [
        { ...credential, signature: new Uint8Array(256).fill(7) },
        { ...credential, message: tampered },
        { ...credential, message: credential.message.slice(1) },
        { ...credential, keyId: "unknown" },
        signedBy(outsider, credential.keyId),
      ];
      for (const forged of forgeries) {
        assert.deepStrictEqual(
          yield* Effect.flip(redeem(forged)),
          new InvalidCredential(),
        );
      }
      yield* redeem(credential);
    }).pipe(Effect.provide(oneKey)),
  );

  it.effect("rejects a double spend, even when both arrive at once", () =>
    Effect.gen(function* () {
      const [first, second] = (yield* obtain("alice-code", 2)).credentials;
      yield* redeem(first);
      assert.deepStrictEqual(
        yield* Effect.flip(redeem(first)),
        new InvalidCredential(),
      );
      const racing = yield* Effect.all(
        [redeem(second), redeem(second)].map(Effect.result),
        { concurrency: "unbounded" },
      );
      assert.strictEqual(racing.filter((r) => r._tag === "Success").length, 1);
    }).pipe(Effect.provide(oneKey)),
  );

  it.effect(
    "refuses issuance without entitlement, to a stale key, or past the quota",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(
          yield* Effect.flip(obtain("guessed-code")),
          new NotEntitled(),
        );
        const issue = Effect.flatMap(ProCredentials, (c) =>
          c.issue({ code: "alice-code", keyId: "old", blindedMessages: [] }),
        );
        assert.deepStrictEqual(yield* Effect.flip(issue), new StaleKey());
        yield* obtain("alice-code", 6);
        assert.instanceOf(
          yield* Effect.flip(obtain("alice-code")),
          RateLimited,
        );
        yield* obtain("bob-code", 6);
        yield* TestClock.adjust("1 day");
        yield* obtain("alice-code", 6);
      }).pipe(
        Effect.provide(
          credentialsWith([{ privateKey: current, expiresAt: 3 * day }]),
        ),
      ),
  );

  it.effect(
    "keeps verifying a rotated-out key until it expires, then rejects its credentials",
    () =>
      Effect.gen(function* () {
        const { keys } = yield* Effect.flatMap(ProCredentials, (c) => c.keys);
        const previousId = keys[1]?.id ?? "";
        yield* redeem(signedBy(previous, previousId));
        yield* TestClock.adjust("1 day");
        assert.lengthOf(
          (yield* Effect.flatMap(ProCredentials, (c) => c.keys)).keys,
          1,
        );
        assert.deepStrictEqual(
          yield* Effect.flip(redeem(signedBy(previous, previousId))),
          new InvalidCredential(),
        );
        yield* redeem((yield* obtain("alice-code")).credentials[0]);
      }).pipe(
        Effect.provide(
          credentialsWith([
            { privateKey: current, expiresAt: 2 * day },
            { privateKey: previous, expiresAt: day },
          ]),
        ),
      ),
  );

  it.effect("fails closed when the spent store is full", () =>
    Effect.gen(function* () {
      const [first, second] = (yield* obtain("alice-code", 2)).credentials;
      yield* redeem(first);
      assert.instanceOf(yield* Effect.flip(redeem(second)), RateLimited);
    }).pipe(
      Effect.provide(
        credentialsWith([{ privateKey: current, expiresAt: day }], {
          maxSpent: 1,
        }),
      ),
    ),
  );

  it.effect(
    "links nothing: issuance values never appear at redemption, and the signer can match the redeemed credential to any issuance",
    () =>
      Effect.gen(function* () {
        const alice = yield* obtain("alice-code");
        const bob = yield* obtain("bob-code");
        const [credential] = alice.credentials;
        assert.isDefined(credential);
        const session = yield* redeem(credential);
        const seenAtRedemption =
          JSON.stringify(Schema.encodeSync(CredentialSchema)(credential)) +
          session.token;

        const { n, e, d } = current.export({ format: "jwk" });
        const [modulus, exponent, privateExponent] = [n, e, d].map((value) =>
          bytesToInt(fromBase64Url(value ?? "")),
        );
        assert.isDefined(modulus);
        assert.isDefined(exponent);
        assert.isDefined(privateExponent);
        const encoded = modPow(
          bytesToInt(credential.signature),
          exponent,
          modulus,
        );

        for (const { request, issued } of [alice, bob]) {
          assert.notInclude(seenAtRedemption, request.code);
          const [blinded] = request.blindedMessages;
          const [blindSignature] = issued.blindSignatures;
          assert.isDefined(blinded);
          assert.isDefined(blindSignature);
          for (const value of [blinded, blindSignature]) {
            assert.notInclude(
              seenAtRedemption,
              Buffer.from(value).toString("base64url"),
            );
          }
          const z = bytesToInt(blinded);
          const r = modPow(
            (z * modInverse(encoded, modulus)) % modulus,
            privateExponent,
            modulus,
          );
          assert.strictEqual(
            (encoded * modPow(r, exponent, modulus)) % modulus,
            z,
          );
        }
      }).pipe(Effect.provide(oneKey)),
  );
});

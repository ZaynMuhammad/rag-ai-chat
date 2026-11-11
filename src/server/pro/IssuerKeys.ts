import {
  createPrivateKey,
  createPublicKey,
  generateKeyPair,
  type KeyObject,
} from "node:crypto";
import { promisify } from "node:util";
import {
  Array as Arr,
  Clock,
  Config,
  DateTime,
  Duration,
  Effect,
  Option,
  Redacted,
  Schema,
} from "effect";
import { type BlindRsaPublicKey, importPublicKey, keyId } from "@/lib/blindRsa";

export interface SigningKey {
  readonly privateKey: KeyObject;
  readonly expiresAt: number;
}

export interface IssuerKey extends SigningKey {
  readonly id: string;
  readonly spki: Uint8Array<ArrayBuffer>;
  readonly publicKey: BlindRsaPublicKey;
}

export class InvalidSigningKeys extends Schema.TaggedError<InvalidSigningKeys>()(
  "InvalidSigningKeys",
  { message: Schema.String },
) {}

export const ephemeralKeyLifetime = Duration.days(7);

export const prepareKey = Effect.fnUntraced(function* (key: SigningKey) {
  const spki = new Uint8Array(
    createPublicKey(key.privateKey).export({ type: "spki", format: "der" }),
  );
  return {
    ...key,
    spki,
    id: yield* Effect.promise(() => keyId(spki)),
    publicKey: yield* Effect.promise(() => importPublicKey(spki)),
  } satisfies IssuerKey;
});

export const generateSigningKey = Effect.fnUntraced(function* (
  lifetime: Duration.Input,
) {
  const { privateKey } = yield* Effect.promise(() =>
    promisify(generateKeyPair)("rsa", { modulusLength: 2048 }),
  );
  return {
    privateKey,
    expiresAt: (yield* Clock.currentTimeMillis) + Duration.toMillis(lifetime),
  } satisfies SigningKey;
});

const pemBlocks = (text: string) =>
  text.match(/-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g) ?? [];

export const configuredSigningKeys = Effect.gen(function* () {
  const pem = yield* Config.option(Config.Redacted("PRO_SIGNING_KEY"));
  if (Option.isNone(pem)) {
    return [yield* generateSigningKey(ephemeralKeyLifetime)];
  }
  const blocks = pemBlocks(Redacted.value(pem.value));
  const expiries = Option.all(
    (yield* Config.String("PRO_SIGNING_KEY_EXPIRES"))
      .split(",")
      .map((date) =>
        DateTime.make(date.trim()).pipe(Option.map(DateTime.toEpochMillis)),
      ),
  );
  if (
    blocks.length === 0 ||
    Option.isNone(expiries) ||
    expiries.value.length !== blocks.length
  ) {
    return yield* new InvalidSigningKeys({
      message:
        "PRO_SIGNING_KEY needs one PEM private key per date in PRO_SIGNING_KEY_EXPIRES, newest first",
    });
  }
  const zipped = Arr.zip(blocks, expiries.value);
  return yield* Effect.try({
    try: () =>
      zipped.map(([block, expiresAt]): SigningKey => {
        const privateKey = createPrivateKey(block);
        if (privateKey.asymmetricKeyType !== "rsa") throw new Error("not RSA");
        return { privateKey, expiresAt };
      }),
    catch: () =>
      new InvalidSigningKeys({
        message: "PRO_SIGNING_KEY must hold PEM-encoded RSA private keys",
      }),
  });
});

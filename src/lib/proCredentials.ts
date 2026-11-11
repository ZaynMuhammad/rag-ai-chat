import { Array as Arr } from "effect";
import type { Credential, PublishedKey } from "@/server/pro/ProProtocol";
import {
  blind,
  BlindRsaError,
  finalize,
  importPublicKey,
  keyId,
  randomMessage,
} from "./blindRsa";

export const prepareBatch = async (published: PublishedKey, count: number) => {
  const spki = new Uint8Array(published.spki);
  if ((await keyId(spki)) !== published.id) {
    throw new BlindRsaError("published key id does not match the key");
  }
  const publicKey = await importPublicKey(spki);
  const messages = Array.from({ length: count }, randomMessage);
  const blinded = await Promise.all(
    messages.map((message) => blind(publicKey, message)),
  );
  return {
    blindedMessages: blinded.map(({ blindedMessage }) => blindedMessage),
    finalize: (blindSignatures: ReadonlyArray<Uint8Array>) => {
      if (blindSignatures.length !== count) {
        throw new BlindRsaError("expected one blind signature per message");
      }
      return Promise.all(
        Arr.zipWith(
          Arr.zip(messages, blinded),
          blindSignatures,
          async (
            [message, { inverse }],
            blindSignature,
          ): Promise<Credential> => ({
            keyId: published.id,
            message,
            signature: await finalize(
              publicKey,
              message,
              new Uint8Array(blindSignature),
              inverse,
            ),
          }),
        ),
      );
    },
  };
};

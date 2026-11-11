import {
  constants,
  type KeyObject,
  privateDecrypt,
  publicEncrypt,
} from "node:crypto";

const rawRsa = (key: KeyObject) => ({ key, padding: constants.RSA_NO_PADDING });

export const blindSign = (
  privateKey: KeyObject,
  blindedMessage: Uint8Array,
) => {
  const signature = privateDecrypt(rawRsa(privateKey), blindedMessage);
  if (!publicEncrypt(rawRsa(privateKey), signature).equals(blindedMessage)) {
    throw new Error("signing failure");
  }
  return new Uint8Array(signature);
};

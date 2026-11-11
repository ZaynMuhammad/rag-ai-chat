import { Schema } from "effect";

export const maxBatchSize = 10;

const Bytes = Schema.Uint8ArrayFromBase64Url;
const KeyId = Schema.String.check(Schema.isMaxLength(64));

export const PublishedKey = Schema.Struct({
  id: KeyId,
  spki: Bytes,
  expiresAt: Schema.Number,
});
export type PublishedKey = typeof PublishedKey.Type;

export const PublishedKeys = Schema.Struct({
  keys: Schema.Array(PublishedKey),
});
export type PublishedKeys = typeof PublishedKeys.Type;

export const IssueRequest = Schema.Struct({
  code: Schema.String.check(Schema.isMaxLength(256)),
  keyId: KeyId,
  blindedMessages: Schema.Array(Bytes).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(maxBatchSize),
  ),
});
export type IssueRequest = typeof IssueRequest.Type;

export const IssueResponse = Schema.Struct({
  keyId: KeyId,
  blindSignatures: Schema.Array(Bytes),
});
export type IssueResponse = typeof IssueResponse.Type;

export const Credential = Schema.Struct({
  keyId: KeyId,
  message: Bytes,
  signature: Bytes,
});
export type Credential = typeof Credential.Type;

export const SessionRequest = Schema.Struct({
  credential: Schema.optional(Credential),
});

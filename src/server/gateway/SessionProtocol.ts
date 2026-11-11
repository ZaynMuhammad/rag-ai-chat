import { Schema } from "effect";

export const IssuedSession = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.Number,
});
export type IssuedSession = typeof IssuedSession.Type;

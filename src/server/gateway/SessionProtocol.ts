import { Schema } from "effect";

export const Tier = Schema.Literals(["free", "pro"]);
export type Tier = typeof Tier.Type;

export const IssuedSession = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.Number,
  tier: Tier,
});
export type IssuedSession = typeof IssuedSession.Type;

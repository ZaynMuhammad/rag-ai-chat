import { Schema } from "effect";
import type { Scope } from "@/server/games/Scope";

export const RetrievedPassage = Schema.Struct({
  id: Schema.String,
  gameQid: Schema.String,
  title: Schema.String,
  released: Schema.NullOr(Schema.String),
  heading: Schema.String,
  text: Schema.String,
  url: Schema.NullOr(Schema.String),
  revisionId: Schema.NullOr(Schema.Number),
});
export type RetrievedPassage = typeof RetrievedPassage.Type;

export interface SearchRequest {
  readonly query: string;
  readonly scope: Scope;
  readonly limit: number;
}

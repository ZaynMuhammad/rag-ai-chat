import { Schema } from "effect";

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

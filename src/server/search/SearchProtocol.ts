import { Schema } from "effect";

export const SnippetSegment = Schema.Struct({
  text: Schema.String,
  matched: Schema.Boolean,
});
export type SnippetSegment = typeof SnippetSegment.Type;

export const SearchHit = Schema.Struct({
  qid: Schema.String,
  title: Schema.String,
  released: Schema.NullOr(Schema.String),
  passageId: Schema.String,
  heading: Schema.String,
  url: Schema.NullOr(Schema.String),
  revisionId: Schema.NullOr(Schema.Number),
  score: Schema.Number,
  snippet: Schema.Array(SnippetSegment),
});
export type SearchHit = typeof SearchHit.Type;

export const AssistDecision = Schema.Struct({
  show: Schema.Boolean,
  confidence: Schema.Number,
});
export type AssistDecision = typeof AssistDecision.Type;

export const SearchResponse = Schema.Struct({
  results: Schema.Array(SearchHit),
  assist: AssistDecision,
});
export type SearchResponse = typeof SearchResponse.Type;

export const SearchQuery = Schema.Struct({
  q: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
});
export type SearchQuery = typeof SearchQuery.Type;

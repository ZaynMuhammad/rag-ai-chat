import { Schema } from "effect";

export const EvalSource = Schema.Literals([
  "hotpotqa",
  "kilt_nq",
  "handwritten",
]);
export type EvalSource = typeof EvalSource.Type;

export class GoldArticle extends Schema.Class<GoldArticle>(
  "rag-ai-chat/evals/GoldArticle",
)({
  qid: Schema.String,
  title: Schema.String,
  evidence: Schema.Array(Schema.String),
}) {}

export class EvalQuestion extends Schema.Class<EvalQuestion>(
  "rag-ai-chat/evals/EvalQuestion",
)({
  id: Schema.String,
  source: EvalSource,
  question: Schema.String,
  answers: Schema.Array(Schema.String),
  answerable: Schema.Boolean,
  gold: Schema.Array(GoldArticle),
  tags: Schema.Array(Schema.String),
}) {}

export const EvalQuestionLine = Schema.fromJsonString(EvalQuestion);

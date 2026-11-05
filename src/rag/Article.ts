import { Schema } from "effect";

export const ArticleId = Schema.String.check(Schema.isMaxLength(100));

export class Article extends Schema.Class<Article>("rag/Article")({
  id: ArticleId,
  title: Schema.String,
  summary: Schema.String,
  url: Schema.String,
}) {}

export class Passage extends Schema.Class<Passage>("rag/Passage")({
  articleId: ArticleId,
  title: Schema.String,
  url: Schema.String,
  text: Schema.String,
}) {}

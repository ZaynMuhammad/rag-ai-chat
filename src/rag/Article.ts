import { Schema } from "effect";

export const ArticleId = Schema.String.check(Schema.isMaxLength(100));

export const Article = Schema.Struct({
  id: ArticleId,
  title: Schema.String,
  summary: Schema.String,
  url: Schema.String,
});
export type Article = typeof Article.Type;

export const Passage = Schema.Struct({
  articleId: ArticleId,
  title: Schema.String,
  url: Schema.String,
  text: Schema.String,
});
export type Passage = typeof Passage.Type;

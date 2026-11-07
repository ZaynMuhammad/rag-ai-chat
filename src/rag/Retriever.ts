import { Context, Effect, Layer } from "effect";
import type { Article, Passage } from "./Article";
import { catalog } from "./catalog";

const stopWords = new Set([
  "the", "and", "for", "are", "was", "what", "who", "how", "why", "when", "where",
  "does", "did", "can", "with", "from", "that", "this", "about", "tell", "into", "its",
]);

const terms = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 2 && !stopWords.has(term)),
  );

const score = (queryTerms: ReadonlySet<string>, article: Article) => {
  const titleTerms = terms(article.title);
  const summaryTerms = terms(article.summary);
  let total = 0;
  for (const term of queryTerms) {
    if (titleTerms.has(term)) total += 2;
    if (summaryTerms.has(term)) total += 1;
  }
  return total;
};

const toPassage = (article: Article): Passage => ({
  articleId: article.id,
  title: article.title,
  url: article.url,
  text: article.summary,
});

export class Retriever extends Context.Service<
  Retriever,
  {
    retrieve(
      query: string,
      articleIds: ReadonlyArray<string>,
    ): Effect.Effect<ReadonlyArray<Passage>>;
  }
>()("rag-ai-chat/rag/Retriever") {
  static readonly topK = 3;

  static readonly make = (articles: ReadonlyArray<Article>) =>
    Retriever.of({
      retrieve: Effect.fn("Retriever.retrieve")(function* (
        query: string,
        articleIds: ReadonlyArray<string>,
      ) {
        const selected = new Set(articleIds);
        const queryTerms = terms(query);
        return articles
          .filter((article) => selected.has(article.id))
          .map((article) => ({ article, score: score(queryTerms, article) }))
          .filter((ranked) => ranked.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, Retriever.topK)
          .map((ranked) => toPassage(ranked.article));
      }),
    });

  static readonly layer = Layer.succeed(Retriever, Retriever.make(catalog));
}

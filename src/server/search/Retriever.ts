import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Scope, scopeConditions } from "@/server/games/Scope";

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

const stopWords = new Set(
  (
    "a an and are as at be but by can did do does for from had has have how i " +
    "if in into is it its me my of on or tell than that the their them there " +
    "these they this to was were what when where which who whom why will with " +
    "would you your about"
  ).split(" "),
);

const maxTerms = 24;

export const searchTerms = (query: string) =>
  [
    ...new Set(
      (
        query
          .normalize("NFKC")
          .toLowerCase()
          .match(/[\p{L}\p{N}]+/gu) ?? []
      ).filter(
        (term) => !stopWords.has(term) && (term.length > 1 || /\d/.test(term)),
      ),
    ),
  ].slice(0, maxTerms);

export const matchExpression = (terms: ReadonlyArray<string>) =>
  terms.map((term) => `"${term}"`).join(" OR ");

export interface RetrieverOptions {
  readonly headingWeight: number;
}

const SearchRow = Schema.Struct({
  match: Schema.String,
  limit: Schema.Number,
  scope: Scope,
});

export class Retriever extends Context.Service<
  Retriever,
  {
    search(
      request: SearchRequest,
    ): Effect.Effect<ReadonlyArray<RetrievedPassage>>;
  }
>()("rag-ai-chat/search/Retriever") {
  static readonly make = (options: RetrieverOptions) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const ranked = SqlSchema.findAll({
        Request: SearchRow,
        Result: RetrievedPassage,
        execute: ({ match, limit, scope }) => sql`
          SELECT
            passages.id, passages.game_qid AS gameQid, games.title, games.released,
            passages.heading, passages.text, games.url, games.revision_id AS revisionId
          FROM passages_fts
          JOIN passages ON passages.rowid = passages_fts.rowid
          JOIN games ON games.qid = passages.game_qid
          WHERE passages_fts MATCH ${match} AND ${sql.and(scopeConditions(sql, scope))}
          ORDER BY bm25(passages_fts, ${options.headingWeight}, 1.0)
          LIMIT ${limit}
        `,
      });

      const search = Effect.fn("Retriever.search")(function* (
        request: SearchRequest,
      ) {
        const terms = searchTerms(request.query);
        if (terms.length === 0) return [];
        return yield* ranked({
          match: matchExpression(terms),
          limit: request.limit,
          scope: request.scope,
        });
      }, Effect.orDie);

      return Retriever.of({ search });
    });

  static readonly layer = Layer.effect(
    Retriever,
    Retriever.make({ headingWeight: 2 }),
  );
}

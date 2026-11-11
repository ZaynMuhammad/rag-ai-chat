import { Config, Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Scope, scopeConditions } from "@/server/games/Scope";
import { words } from "@/corpus/Terms";
import { RetrievedPassage } from "./Passage";

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
      words(query).filter(
        (term) => !stopWords.has(term) && (term.length > 1 || /\d/.test(term)),
      ),
    ),
  ].slice(0, maxTerms);

const anyOf = (terms: ReadonlyArray<string>) =>
  terms.map((term) => `"${term}"`).join(" OR ");

export const matchExpression = (
  terms: ReadonlyArray<string>,
  commonTerms: ReadonlySet<string> = new Set(),
) => {
  const distinctive = terms.filter((term) => !commonTerms.has(term));
  return distinctive.length === 0 || distinctive.length === terms.length
    ? anyOf(terms)
    : `(${anyOf(distinctive)}) AND (${anyOf(terms)})`;
};

export interface RetrieverOptions {
  readonly headingWeight: number;
  readonly commonTermShare: number | null;
}

export const defaultRetrieverOptions: RetrieverOptions = {
  headingWeight: 2,
  commonTermShare: null,
};

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

      const commonTerms = new Set(
        options.commonTermShare === null
          ? []
          : (yield* SqlSchema.findAll({
              Request: Schema.Number,
              Result: Schema.Struct({ term: Schema.String }),
              execute: (share) => sql`
                SELECT term FROM common_terms
                WHERE documents >= ${share} * (SELECT COUNT(*) FROM passages)
              `,
            })(options.commonTermShare).pipe(Effect.orDie)).map(
              (row) => row.term,
            ),
      );

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
          match: matchExpression(terms, commonTerms),
          limit: request.limit,
          scope: request.scope,
        });
      }, Effect.orDie);

      return Retriever.of({ search });
    });

  static readonly layer = Layer.effect(
    Retriever,
    Effect.gen(function* () {
      const commonTermShare = yield* Config.option(
        Config.Number("RETRIEVAL_COMMON_WORD_SHARE"),
      );
      return yield* Retriever.make({
        ...defaultRetrieverOptions,
        commonTermShare: Option.getOrNull(commonTermShare),
      });
    }),
  );
}

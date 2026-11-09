import { Config, Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Scope, scopeConditions } from "@/server/games/Scope";
import { words } from "@/corpus/Terms";
import { DenseIndex } from "./DenseIndex";
import { Embedder } from "./Embedder";
import { defaultFusionK, reciprocalRankFusion } from "./Fusion";
import { RetrievedPassage, type SearchRequest } from "./Passage";

export const RetrievalMode = Schema.Literals(["bm25", "dense", "hybrid"]);
export type RetrievalMode = typeof RetrievalMode.Type;
export const defaultRetrievalMode: RetrievalMode = "dense";

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

export interface FusionOptions {
  readonly mode: "dense" | "hybrid";
  readonly k: number;
  readonly candidates: number;
}

export const defaultFusionOptions: FusionOptions = {
  mode: "hybrid",
  k: defaultFusionK,
  candidates: 50,
};

const SearchRow = Schema.Struct({
  match: Schema.String,
  limit: Schema.Number,
  scope: Scope,
});

const hasEmbeddings = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`SELECT 1 FROM passage_embeddings LIMIT 1`;
  return rows.length > 0;
}).pipe(Effect.orElseSucceed(() => false));

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

  static readonly makeFused = (
    options: RetrieverOptions,
    fusion: FusionOptions,
  ) =>
    Effect.gen(function* () {
      const lexical = yield* Retriever.make(options);
      const dense = yield* DenseIndex;

      const hybrid = Effect.fnUntraced(function* (request: SearchRequest) {
        const candidates = {
          ...request,
          limit: Math.max(request.limit, fusion.candidates),
        };
        const [semantic, keyword] = yield* Effect.all(
          [dense.search(candidates), lexical.search(candidates)],
          { concurrency: "unbounded" },
        );
        return reciprocalRankFusion(
          [keyword, semantic],
          (passage) => passage.id,
          fusion.k,
        ).slice(0, request.limit);
      });

      const search = Effect.fn("Retriever.search")(function* (
        request: SearchRequest,
      ) {
        if (searchTerms(request.query).length === 0) return [];
        return fusion.mode === "dense"
          ? yield* dense.search(request)
          : yield* hybrid(request);
      });

      return Retriever.of({ search });
    });

  static readonly layerBm25 = Layer.effect(
    Retriever,
    Retriever.make(defaultRetrieverOptions),
  );

  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const mode = yield* Config.Literals(
        RetrievalMode.literals,
        "RETRIEVAL_MODE",
      ).pipe(Config.withDefault(defaultRetrievalMode));
      const commonTermShare = yield* Config.option(
        Config.Number("RETRIEVAL_COMMON_WORD_SHARE"),
      );
      const options = {
        ...defaultRetrieverOptions,
        commonTermShare: Option.getOrNull(commonTermShare),
      };
      const dense = mode !== "bm25" && (yield* hasEmbeddings);
      if (mode !== "bm25" && !dense) {
        yield* Effect.logWarning(
          `RETRIEVAL_MODE=${mode}, but the corpus has no passage embeddings. Using bm25 until bun run corpus:embed has run.`,
        );
      }
      return mode === "bm25" || !dense
        ? Layer.effect(Retriever, Retriever.make(options))
        : Layer.effect(
            Retriever,
            Retriever.makeFused(options, { ...defaultFusionOptions, mode }),
          ).pipe(
            Layer.provide(DenseIndex.layer.pipe(Layer.provide(Embedder.layer))),
          );
    }),
  );
}

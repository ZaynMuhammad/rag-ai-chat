import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import {
  type AssistSignals,
  assistDecision,
  assistSignals,
} from "./AssistGate";
import {
  defaultRetrieverOptions,
  matchExpression,
  searchTerms,
} from "./Retriever";
import type {
  AssistDecision,
  SearchHit,
  SnippetSegment,
} from "./SearchProtocol";

export const candidateDepth = 60;
export const resultLimit = 10;
const snippetTokens = 32;

const matchStart = String.fromCharCode(2);
const matchEnd = String.fromCharCode(3);

export const snippetSegments = (
  marked: string,
): ReadonlyArray<SnippetSegment> =>
  marked
    .split(matchStart)
    .flatMap((chunk, index) => {
      if (index === 0) return [{ text: chunk, matched: false }];
      const end = chunk.indexOf(matchEnd);
      return end === -1
        ? [{ text: chunk, matched: true }]
        : [
            { text: chunk.slice(0, end), matched: true },
            { text: chunk.slice(end + 1), matched: false },
          ];
    })
    .filter((segment) => segment.text !== "");

export const bestPassagePerGame = <A extends { readonly qid: string }>(
  ranked: ReadonlyArray<A>,
) =>
  ranked.filter(
    (candidate, index) =>
      ranked.findIndex((other) => other.qid === candidate.qid) === index,
  );

const Candidate = Schema.Struct({
  rowid: Schema.Number,
  passageId: Schema.String,
  qid: Schema.String,
  title: Schema.String,
  released: Schema.NullOr(Schema.String),
  heading: Schema.String,
  url: Schema.NullOr(Schema.String),
  revisionId: Schema.NullOr(Schema.Number),
  score: Schema.Number,
});

const Snippet = Schema.Struct({ rowid: Schema.Number, marked: Schema.String });

export interface SearchPage {
  readonly results: ReadonlyArray<SearchHit>;
  readonly signals: AssistSignals;
  readonly assist: AssistDecision;
}

const emptySignals = assistSignals([], 0, 0);
const emptyPage: SearchPage = {
  results: [],
  signals: emptySignals,
  assist: assistDecision(emptySignals),
};

export class SearchResults extends Context.Service<
  SearchResults,
  { search(query: string): Effect.Effect<SearchPage> }
>()("rag-ai-chat/search/SearchResults") {
  static readonly layer = Layer.effect(
    SearchResults,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { headingWeight } = defaultRetrieverOptions;

      const candidates = SqlSchema.findAll({
        Request: Schema.String,
        Result: Candidate,
        execute: (match) => sql`
          SELECT
            passages.rowid AS rowid, passages.id AS passageId, passages.game_qid AS qid,
            games.title, games.released, passages.heading, games.url,
            games.revision_id AS revisionId,
            -bm25(passages_fts, ${headingWeight}, 1.0) AS score
          FROM passages_fts
          JOIN passages ON passages.rowid = passages_fts.rowid
          JOIN games ON games.qid = passages.game_qid
          WHERE passages_fts MATCH ${match}
          ORDER BY bm25(passages_fts, ${headingWeight}, 1.0)
          LIMIT ${candidateDepth}
        `,
      });

      const snippets = SqlSchema.findAll({
        Request: Schema.Struct({
          match: Schema.String,
          rowids: Schema.Array(Schema.Number),
        }),
        Result: Snippet,
        execute: ({ match, rowids }) => sql`
          SELECT
            rowid,
            snippet(passages_fts, 1, char(2), char(3), '…', ${snippetTokens}) AS marked
          FROM passages_fts
          WHERE passages_fts MATCH ${match} AND rowid IN ${sql.in(rowids)}
        `,
      });

      const passageMatches = SqlSchema.findAll({
        Request: Schema.Struct({ match: Schema.String, rowid: Schema.Number }),
        Result: Schema.Struct({ rowid: Schema.Number }),
        execute: ({ match, rowid }) => sql`
          SELECT rowid FROM passages_fts
          WHERE passages_fts MATCH ${match} AND rowid = ${rowid}
        `,
      });

      const matchedTerms = (terms: ReadonlyArray<string>, rowid: number) =>
        Effect.map(
          Effect.forEach(terms, (term) =>
            passageMatches({ match: matchExpression([term]), rowid }),
          ),
          (matches) => matches.filter((rows) => rows.length > 0).length,
        );

      const search = Effect.fn("SearchResults.search")(function* (
        query: string,
      ) {
        const terms = searchTerms(query);
        if (terms.length === 0) return emptyPage;
        const match = matchExpression(terms);
        const ranked = yield* candidates(match);
        const [first] = ranked;
        if (first === undefined) return emptyPage;
        const hits = bestPassagePerGame(ranked).slice(0, resultLimit);
        const marked = new Map(
          (yield* snippets({
            match,
            rowids: hits.map((hit) => hit.rowid),
          })).map((row) => [row.rowid, row.marked]),
        );
        const signals = assistSignals(
          ranked.map(({ qid, score }) => ({ gameQid: qid, score })),
          yield* matchedTerms(terms, first.rowid),
          terms.length,
        );
        return {
          results: hits.map(({ rowid, ...hit }) => ({
            ...hit,
            snippet: snippetSegments(marked.get(rowid) ?? ""),
          })),
          signals,
          assist: assistDecision(signals),
        };
      }, Effect.orDie);

      return SearchResults.of({ search });
    }),
  );
}

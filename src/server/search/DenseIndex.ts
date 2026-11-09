import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Scope, scopeConditions } from "@/server/games/Scope";
import { Embedder } from "./Embedder";
import { RetrievedPassage, type SearchRequest } from "./Passage";
import { allRows, blobToCodes, nearest, type QuantizedMatrix } from "./Vectors";

const rowsPerRead = 10_000;

const EmbeddingRow = Schema.Struct({
  rowid: Schema.Number,
  vector: Schema.Uint8Array,
  scale: Schema.Number,
});

const RowidOnly = Schema.Struct({ rowid: Schema.Number });

const RankedPassage = Schema.Struct({
  ...RetrievedPassage.fields,
  rowid: Schema.Number,
});

export interface DenseIndexSize {
  readonly passages: number;
  readonly dimensions: number;
  readonly bytes: number;
}

const indexOfRowid = (rowids: Float64Array, rowid: number) => {
  let low = 0;
  let high = rowids.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const value = rowids[middle] ?? 0;
    if (value === rowid) return middle;
    if (value < rowid) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
};

export class DenseIndex extends Context.Service<
  DenseIndex,
  {
    readonly size: DenseIndexSize;
    search(
      request: SearchRequest,
    ): Effect.Effect<ReadonlyArray<RetrievedPassage>>;
  }
>()("rag-ai-chat/search/DenseIndex") {
  static readonly layer = Layer.effect(
    DenseIndex,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const embedder = yield* Embedder;
      const dimensions = embedder.dimensions;

      const countRows = SqlSchema.findOne({
        Request: Schema.Void,
        Result: Schema.Struct({ count: Schema.Number }),
        execute: () => sql`
          SELECT COUNT(*) AS count FROM passage_embeddings
          JOIN passages ON passages.id = passage_embeddings.passage_id
        `,
      });
      const readRows = SqlSchema.findAll({
        Request: Schema.Number,
        Result: EmbeddingRow,
        execute: (after) => sql`
          SELECT passages.rowid AS rowid, passage_embeddings.vector, passage_embeddings.scale
          FROM passage_embeddings
          JOIN passages ON passages.id = passage_embeddings.passage_id
          WHERE passages.rowid > ${after}
          ORDER BY passages.rowid
          LIMIT ${rowsPerRead}
        `,
      });

      const { count } = yield* countRows(undefined).pipe(Effect.orDie);
      const rowids = new Float64Array(count);
      const matrix: QuantizedMatrix = {
        dimensions,
        codes: new Int8Array(count * dimensions),
        scales: new Float32Array(count),
      };
      let loaded = 0;
      let after = 0;
      while (loaded < count) {
        const rows = yield* readRows(after).pipe(Effect.orDie);
        const last = rows.at(-1);
        if (last === undefined) break;
        for (const row of rows) {
          if (row.vector.byteLength !== dimensions) {
            return yield* Effect.die(
              new Error(
                `Passage embedding has ${row.vector.byteLength} dimensions, but ${embedder.model} makes ${dimensions}. Re-run bun run corpus:embed.`,
              ),
            );
          }
          if (loaded === count) break;
          rowids[loaded] = row.rowid;
          matrix.codes.set(blobToCodes(row.vector), loaded * dimensions);
          matrix.scales[loaded] = row.scale;
          loaded++;
        }
        after = last.rowid;
      }

      const scopedRowids = SqlSchema.findAll({
        Request: Scope,
        Result: RowidOnly,
        execute: (scope) => sql`
          SELECT passages.rowid AS rowid FROM passages
          JOIN games ON games.qid = passages.game_qid
          WHERE ${sql.and(scopeConditions(sql, scope))}
        `,
      });

      const candidateRows = Effect.fnUntraced(function* (scope: Scope) {
        if (scopeConditions(sql, scope).length === 0) return allRows(loaded);
        const inScope = yield* scopedRowids(scope);
        return inScope
          .map(({ rowid }) => indexOfRowid(rowids, rowid))
          .filter((row) => row !== -1);
      });

      const passagesAt = SqlSchema.findAll({
        Request: Schema.Array(Schema.Number),
        Result: RankedPassage,
        execute: (ids) => sql`
          SELECT
            passages.rowid AS rowid, passages.id, passages.game_qid AS gameQid, games.title,
            games.released, passages.heading, passages.text, games.url,
            games.revision_id AS revisionId
          FROM passages
          JOIN games ON games.qid = passages.game_qid
          WHERE ${sql.in("passages.rowid", ids)}
        `,
      });

      const search = Effect.fn("DenseIndex.search")(function* (
        request: SearchRequest,
      ) {
        if (loaded === 0 || request.limit <= 0) return [];
        const query = yield* embedder.embedQuery(request.query);
        const rows = yield* candidateRows(request.scope);
        const ranked = nearest(matrix, query, rows, request.limit).map(
          ({ row }) => rowids[row] ?? 0,
        );
        if (ranked.length === 0) return [];
        const byRowid = new Map(
          (yield* passagesAt(ranked)).map(({ rowid, ...passage }) => [
            rowid,
            passage,
          ]),
        );
        return ranked.flatMap((rowid) => byRowid.get(rowid) ?? []);
      }, Effect.orDie);

      return DenseIndex.of({
        size: {
          passages: loaded,
          dimensions,
          bytes:
            matrix.codes.byteLength +
            matrix.scales.byteLength +
            rowids.byteLength,
        },
        search,
      });
    }),
  );
}

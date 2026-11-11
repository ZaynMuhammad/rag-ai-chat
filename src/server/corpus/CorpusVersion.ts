import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

const Fingerprint = Schema.Struct({
  passages: Schema.Number,
  revisions: Schema.Number,
});

export const corpusVersion = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fingerprint = yield* SqlSchema.findOne({
    Request: Schema.Void,
    Result: Fingerprint,
    execute: () => sql`
      SELECT
        (SELECT COUNT(*) FROM passages) AS passages,
        (SELECT TOTAL(revision_id) FROM games) AS revisions
    `,
  })(undefined);
  return `passages:${fingerprint.passages};revisions:${fingerprint.revisions}`;
}).pipe(Effect.withSpan("CorpusVersion.read"));

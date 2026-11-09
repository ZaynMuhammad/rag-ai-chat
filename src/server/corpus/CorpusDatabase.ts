import { SqliteClient } from "@effect/sql-sqlite-node";
import { Config, Effect, Layer } from "effect";

export const CorpusDatabase = Layer.unwrap(
  Effect.gen(function* () {
    const filename = yield* Config.String("CORPUS_DATABASE").pipe(
      Config.withDefault("data/corpus/games.sqlite"),
    );
    return SqliteClient.layer({ filename, readonly: true });
  }),
);

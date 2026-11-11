import { BunServices } from "@effect/platform-bun";
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun";
import { Effect, FileSystem, Layer } from "effect";
import { CorpusStore, migrations } from "../../src/corpus/CorpusStore";

export const dataDirectory = new URL("../../data/", import.meta.url).pathname;
export const corpusDirectory = `${dataDirectory}corpus`;
export const corpusDatabasePath = `${corpusDirectory}/games.sqlite`;

const ensureCorpusDirectory = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(corpusDirectory, { recursive: true });
  }),
);

const sqlite = SqliteClient.layer({ filename: corpusDatabasePath }).pipe(
  Layer.provide(ensureCorpusDirectory),
);

const migrated = SqliteMigrator.layer({
  loader: SqliteMigrator.fromRecord(migrations),
}).pipe(Layer.provideMerge(sqlite), Layer.provide(BunServices.layer));

export const CorpusDatabase = CorpusStore.layer.pipe(
  Layer.provideMerge(migrated),
);

import { Array as Arr, Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import type { CatalogGame } from "./Catalog";
import type { Chunk } from "./Chunker";
import type { Release } from "./ReleaseDate";
import type { StructuredArticle } from "./StructuredWikipedia";
import type { GenreRow, Studio } from "./Studios";

export interface IngestedArticle {
  readonly article: StructuredArticle;
  readonly chunks: ReadonlyArray<Chunk>;
}

export const passageId = (qid: string, ordinal: number) => `${qid}#${ordinal}`;

export const latestRevisionPerGame = <A>(
  items: ReadonlyArray<A>,
  articleOf: (item: A) => StructuredArticle,
) => {
  const latest = new Map<string, A>();
  for (const item of items) {
    const current = latest.get(articleOf(item).qid);
    if (
      current === undefined ||
      articleOf(item).revisionId > articleOf(current).revisionId
    ) {
      latest.set(articleOf(item).qid, item);
    }
  }
  return [...latest.values()];
};

export const migrations = {
  "0001_corpus": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE games (
        qid TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        page_id INTEGER,
        revision_id INTEGER,
        url TEXT,
        description TEXT
      )
    `;
    yield* sql`
      CREATE TABLE origins (
        game_qid TEXT NOT NULL REFERENCES games (qid),
        place_qid TEXT NOT NULL,
        place_label TEXT NOT NULL,
        iso2 TEXT NOT NULL,
        country TEXT NOT NULL,
        region TEXT NOT NULL,
        sub_region TEXT NOT NULL,
        intermediate_region TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        source TEXT NOT NULL,
        PRIMARY KEY (game_qid, place_qid)
      )
    `;
    yield* sql`CREATE INDEX origins_by_region ON origins (region, sub_region, iso2)`;
    yield* sql`
      CREATE TABLE passages (
        id TEXT PRIMARY KEY,
        game_qid TEXT NOT NULL REFERENCES games (qid),
        ordinal INTEGER NOT NULL,
        heading TEXT NOT NULL,
        section_path TEXT NOT NULL,
        text TEXT NOT NULL,
        token_estimate INTEGER NOT NULL
      )
    `;
    yield* sql`CREATE INDEX passages_by_game ON passages (game_qid, ordinal)`;
    yield* sql`
      CREATE TABLE ingested_shards (
        name TEXT PRIMARY KEY,
        articles INTEGER NOT NULL,
        passages INTEGER NOT NULL
      )
    `;
  }),
  "0002_release_dates": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`ALTER TABLE games ADD COLUMN released TEXT`;
    yield* sql`ALTER TABLE games ADD COLUMN release_year INTEGER`;
    yield* sql`CREATE INDEX games_by_release ON games (released)`;
  }),
  "0003_passage_search": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE VIRTUAL TABLE passages_fts USING fts5(
        heading,
        text,
        content = 'passages',
        tokenize = 'porter unicode61 remove_diacritics 2'
      )
    `;
  }),
  "0004_common_terms": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE common_terms (
        term TEXT PRIMARY KEY,
        documents INTEGER NOT NULL
      )
    `;
  }),
  "0005_studios_and_genres": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE studios (
        game_qid TEXT NOT NULL REFERENCES games (qid),
        developer_qid TEXT NOT NULL,
        developer_label TEXT NOT NULL,
        place_qid TEXT NOT NULL,
        place_label TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        PRIMARY KEY (game_qid, developer_qid)
      )
    `;
    yield* sql`CREATE INDEX studios_by_place ON studios (place_qid)`;
    yield* sql`
      CREATE TABLE genres (
        game_qid TEXT NOT NULL REFERENCES games (qid),
        genre_qid TEXT NOT NULL,
        label TEXT NOT NULL,
        PRIMARY KEY (game_qid, genre_qid)
      )
    `;
    yield* sql`
      CREATE VIEW pins AS
      SELECT DISTINCT game_qid, place_qid, place_label, latitude, longitude, 'studio' AS kind
      FROM studios
      UNION ALL
      SELECT game_qid, place_qid, place_label, latitude, longitude, 'country' AS kind
      FROM origins
      WHERE game_qid NOT IN (SELECT game_qid FROM studios)
    `;
  }),
  "0006_passage_embeddings": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE passage_embeddings (
        passage_id TEXT PRIMARY KEY REFERENCES passages (id),
        vector BLOB NOT NULL,
        scale REAL NOT NULL
      ) WITHOUT ROWID
    `;
  }),
};

const rowsPerStatement = 500;

export class GameTitle extends Schema.Class<GameTitle>(
  "rag-ai-chat/corpus/GameTitle",
)({
  qid: Schema.String,
  title: Schema.String,
}) {}

export class StoredPassage extends Schema.Class<StoredPassage>(
  "rag-ai-chat/corpus/StoredPassage",
)({
  id: Schema.String,
  gameQid: Schema.String,
  heading: Schema.String,
  text: Schema.String,
}) {}

export class PlacedGameRow extends Schema.Class<PlacedGameRow>(
  "rag-ai-chat/corpus/PlacedGameRow",
)({
  qid: Schema.String,
  title: Schema.String,
  url: Schema.NullOr(Schema.String),
  passages: Schema.Number,
  placeLabel: Schema.String,
  iso2: Schema.String,
  country: Schema.String,
  region: Schema.String,
  subRegion: Schema.String,
  latitude: Schema.Number,
  longitude: Schema.Number,
}) {}

export class PassageText extends Schema.Class<PassageText>(
  "rag-ai-chat/corpus/PassageText",
)({
  rowid: Schema.Number,
  text: Schema.String,
}) {}

export class PassageToEmbed extends Schema.Class<PassageToEmbed>(
  "rag-ai-chat/corpus/PassageToEmbed",
)({
  rowid: Schema.Number,
  id: Schema.String,
  heading: Schema.String,
  text: Schema.String,
}) {}

export interface PassageEmbedding {
  readonly passageId: string;
  readonly vector: Uint8Array;
  readonly scale: number;
}

export class EmbeddingProgress extends Schema.Class<EmbeddingProgress>(
  "rag-ai-chat/corpus/EmbeddingProgress",
)({
  passages: Schema.Number,
  embedded: Schema.Number,
}) {}

export class CorpusStats extends Schema.Class<CorpusStats>(
  "rag-ai-chat/corpus/CorpusStats",
)({
  games: Schema.Number,
  gamesWithText: Schema.Number,
  passages: Schema.Number,
  tokens: Schema.Number,
  shards: Schema.Number,
}) {}

export class CorpusStore extends Context.Service<
  CorpusStore,
  {
    saveCatalog(games: ReadonlyArray<CatalogGame>): Effect.Effect<void>;
    saveReleases(releases: ReadonlyArray<Release>): Effect.Effect<void>;
    saveStudios(studios: ReadonlyArray<Studio>): Effect.Effect<void>;
    saveGenres(genres: ReadonlyArray<GenreRow>): Effect.Effect<void>;
    readonly rebuildSearchIndex: Effect.Effect<void>;
    passageTextsAfter(
      rowid: number,
      limit: number,
    ): Effect.Effect<ReadonlyArray<PassageText>>;
    saveCommonTerms(
      terms: ReadonlyArray<{
        readonly term: string;
        readonly documents: number;
      }>,
    ): Effect.Effect<void>;
    passagesToEmbedAfter(
      rowid: number,
      limit: number,
    ): Effect.Effect<ReadonlyArray<PassageToEmbed>>;
    saveEmbeddings(
      embeddings: ReadonlyArray<PassageEmbedding>,
    ): Effect.Effect<void>;
    readonly embeddingProgress: Effect.Effect<EmbeddingProgress>;
    readonly ingestedShards: Effect.Effect<ReadonlySet<string>>;
    readonly gameTitles: Effect.Effect<ReadonlyArray<GameTitle>>;
    passagesOf(
      gameQids: ReadonlyArray<string>,
    ): Effect.Effect<ReadonlyArray<StoredPassage>>;
    readonly placedGames: Effect.Effect<ReadonlyArray<PlacedGameRow>>;
    saveShard(
      shard: string,
      articles: ReadonlyArray<IngestedArticle>,
    ): Effect.Effect<void>;
    readonly stats: Effect.Effect<CorpusStats>;
  }
>()("rag-ai-chat/corpus/CorpusStore") {
  static readonly layer = Layer.effect(
    CorpusStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const insertInBatches = (
        table: string,
        rows: ReadonlyArray<Record<string, unknown>>,
      ) =>
        Effect.forEach(
          Arr.chunksOf(rows, rowsPerStatement),
          (batch) => sql`INSERT INTO ${sql(table)} ${sql.insert(batch)}`,
          { discard: true },
        );

      const saveCatalog = Effect.fn("CorpusStore.saveCatalog")(
        function* (games: ReadonlyArray<CatalogGame>) {
          yield* sql`DELETE FROM origins`;
          for (const batch of Arr.chunksOf(games, rowsPerStatement)) {
            yield* sql`
              INSERT INTO games ${sql.insert(Arr.map(batch, (game) => ({ qid: game.qid, title: game.title })))}
              ON CONFLICT (qid) DO UPDATE SET title = excluded.title
            `;
          }
          yield* insertInBatches(
            "origins",
            games.flatMap((game) =>
              game.origins.map((origin) => ({
                game_qid: game.qid,
                place_qid: origin.placeQid,
                place_label: origin.placeLabel,
                iso2: origin.iso2,
                country: origin.country,
                region: origin.region,
                sub_region: origin.subRegion,
                intermediate_region: origin.intermediateRegion,
                latitude: origin.latitude,
                longitude: origin.longitude,
                source: origin.source,
              })),
            ),
          );
        },
        sql.withTransaction,
        Effect.orDie,
      );

      const saveReleases = Effect.fn("CorpusStore.saveReleases")(
        function* (releases: ReadonlyArray<Release>) {
          yield* sql`UPDATE games SET released = NULL, release_year = NULL`;
          for (const release of releases) {
            yield* sql`
              UPDATE games
              SET released = ${release.released}, release_year = ${release.year}
              WHERE qid = ${release.gameQid}
            `;
          }
        },
        sql.withTransaction,
        Effect.orDie,
      );

      const saveStudios = Effect.fn("CorpusStore.saveStudios")(
        function* (studios: ReadonlyArray<Studio>) {
          yield* sql`DELETE FROM studios`;
          yield* insertInBatches(
            "studios",
            studios.map((studio) => ({
              game_qid: studio.gameQid,
              developer_qid: studio.developerQid,
              developer_label: studio.developerLabel,
              place_qid: studio.placeQid,
              place_label: studio.placeLabel,
              latitude: studio.latitude,
              longitude: studio.longitude,
            })),
          );
        },
        sql.withTransaction,
        Effect.orDie,
      );

      const saveGenres = Effect.fn("CorpusStore.saveGenres")(
        function* (genres: ReadonlyArray<GenreRow>) {
          yield* sql`DELETE FROM genres`;
          yield* insertInBatches(
            "genres",
            genres.map((genre) => ({
              game_qid: genre.gameQid,
              genre_qid: genre.genreQid,
              label: genre.label,
            })),
          );
        },
        sql.withTransaction,
        Effect.orDie,
      );

      const rebuildSearchIndex = sql`
        INSERT INTO passages_fts (passages_fts) VALUES ('rebuild')
      `.pipe(
        Effect.asVoid,
        Effect.orDie,
        Effect.withSpan("CorpusStore.rebuildSearchIndex"),
      );

      const passageTextsAfter = Effect.fn("CorpusStore.passageTextsAfter")(
        function* (rowid: number, limit: number) {
          return yield* SqlSchema.findAll({
            Request: Schema.Void,
            Result: PassageText,
            execute: () => sql`
              SELECT rowid, heading || ' ' || text AS text FROM passages
              WHERE rowid > ${rowid} ORDER BY rowid LIMIT ${limit}
            `,
          })(undefined);
        },
        Effect.orDie,
      );

      const saveCommonTerms = Effect.fn("CorpusStore.saveCommonTerms")(
        function* (
          terms: ReadonlyArray<{
            readonly term: string;
            readonly documents: number;
          }>,
        ) {
          yield* sql`DELETE FROM common_terms`;
          yield* insertInBatches("common_terms", terms);
        },
        sql.withTransaction,
        Effect.orDie,
      );

      const passagesToEmbedAfter = Effect.fn(
        "CorpusStore.passagesToEmbedAfter",
      )(function* (rowid: number, limit: number) {
        return yield* SqlSchema.findAll({
          Request: Schema.Void,
          Result: PassageToEmbed,
          execute: () => sql`
            SELECT rowid, id, heading, text FROM passages
            WHERE rowid > ${rowid}
              AND NOT EXISTS (
                SELECT 1 FROM passage_embeddings WHERE passage_id = passages.id
              )
            ORDER BY rowid LIMIT ${limit}
          `,
        })(undefined);
      }, Effect.orDie);

      const saveEmbeddings = Effect.fn("CorpusStore.saveEmbeddings")(
        function* (embeddings: ReadonlyArray<PassageEmbedding>) {
          yield* insertInBatches(
            "passage_embeddings",
            embeddings.map((embedding) => ({
              passage_id: embedding.passageId,
              vector: embedding.vector,
              scale: embedding.scale,
            })),
          );
        },
        sql.withTransaction,
        Effect.orDie,
      );

      const embeddingProgress = SqlSchema.findOne({
        Request: Schema.Void,
        Result: EmbeddingProgress,
        execute: () => sql`
          SELECT
            (SELECT COUNT(*) FROM passages) AS passages,
            (SELECT COUNT(*) FROM passage_embeddings) AS embedded
        `,
      })(undefined).pipe(
        Effect.orDie,
        Effect.withSpan("CorpusStore.embeddingProgress"),
      );

      const ingestedShards = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ name: Schema.String }),
        execute: () => sql`SELECT name FROM ingested_shards`,
      })(undefined).pipe(
        Effect.map((rows) => new Set(rows.map((row) => row.name))),
        Effect.orDie,
        Effect.withSpan("CorpusStore.ingestedShards"),
      );

      const storedRevisions = SqlSchema.findAll({
        Request: Schema.Array(Schema.String),
        Result: Schema.Struct({
          qid: Schema.String,
          revisionId: Schema.Number,
        }),
        execute: (qids) => sql`
          SELECT qid, revision_id AS revisionId FROM games
          WHERE revision_id IS NOT NULL AND ${sql.in("qid", qids)}
        `,
      });

      const saveShard = Effect.fn("CorpusStore.saveShard")(
        function* (
          shard: string,
          shardArticles: ReadonlyArray<IngestedArticle>,
        ) {
          const latestInShard = latestRevisionPerGame(
            shardArticles,
            ({ article }) => article,
          );
          const stored = new Map(
            (yield* Effect.forEach(
              Arr.chunksOf(
                latestInShard.map(({ article }) => article.qid),
                rowsPerStatement,
              ),
              storedRevisions,
            ))
              .flat()
              .map((row) => [row.qid, row.revisionId]),
          );
          const articles = latestInShard.filter(
            ({ article }) =>
              article.revisionId >
              (stored.get(article.qid) ?? Number.NEGATIVE_INFINITY),
          );
          for (const { article } of articles) {
            yield* sql`
              UPDATE games SET
                page_id = ${article.pageId},
                revision_id = ${article.revisionId},
                url = ${article.url},
                description = ${article.description}
              WHERE qid = ${article.qid}
            `;
            yield* sql`
              DELETE FROM passage_embeddings WHERE passage_id IN (
                SELECT id FROM passages WHERE game_qid = ${article.qid}
              )
            `;
            yield* sql`DELETE FROM passages WHERE game_qid = ${article.qid}`;
          }
          const passages = articles.flatMap(({ article, chunks }) =>
            chunks.map((chunk) => ({
              id: passageId(article.qid, chunk.ordinal),
              game_qid: article.qid,
              ordinal: chunk.ordinal,
              heading: chunk.heading,
              section_path: JSON.stringify(chunk.sectionPath),
              text: chunk.text,
              token_estimate: chunk.tokenEstimate,
            })),
          );
          yield* insertInBatches("passages", passages);
          yield* sql`
            INSERT INTO ingested_shards ${sql.insert({ name: shard, articles: articles.length, passages: passages.length })}
          `;
        },
        sql.withTransaction,
        Effect.orDie,
      );

      const stats = SqlSchema.findOne({
        Request: Schema.Void,
        Result: CorpusStats,
        execute: () => sql`
          SELECT
            (SELECT COUNT(*) FROM games) AS games,
            (SELECT COUNT(DISTINCT game_qid) FROM passages) AS gamesWithText,
            (SELECT COUNT(*) FROM passages) AS passages,
            (SELECT COALESCE(SUM(token_estimate), 0) FROM passages) AS tokens,
            (SELECT COUNT(*) FROM ingested_shards) AS shards
        `,
      })(undefined).pipe(Effect.orDie, Effect.withSpan("CorpusStore.stats"));

      const gameTitles = SqlSchema.findAll({
        Request: Schema.Void,
        Result: GameTitle,
        execute: () => sql`SELECT qid, title FROM games ORDER BY qid`,
      })(undefined).pipe(
        Effect.orDie,
        Effect.withSpan("CorpusStore.gameTitles"),
      );

      const passagesInBatch = SqlSchema.findAll({
        Request: Schema.Array(Schema.String),
        Result: StoredPassage,
        execute: (qids) => sql`
          SELECT id, game_qid AS gameQid, heading, text FROM passages
          WHERE ${sql.in("game_qid", qids)}
          ORDER BY game_qid, ordinal
        `,
      });

      const passagesOf = Effect.fn("CorpusStore.passagesOf")(function* (
        gameQids: ReadonlyArray<string>,
      ) {
        const batches = yield* Effect.forEach(
          Arr.chunksOf(gameQids, rowsPerStatement),
          passagesInBatch,
        );
        return batches.flat();
      }, Effect.orDie);

      const placedGames = SqlSchema.findAll({
        Request: Schema.Void,
        Result: PlacedGameRow,
        execute: () => sql`
          SELECT
            games.qid, games.title, games.url,
            (SELECT COUNT(*) FROM passages WHERE passages.game_qid = games.qid) AS passages,
            origins.place_label AS placeLabel, origins.iso2, origins.country, origins.region,
            origins.sub_region AS subRegion, origins.latitude, origins.longitude
          FROM origins JOIN games ON games.qid = origins.game_qid
          ORDER BY games.qid, origins.place_qid
        `,
      })(undefined).pipe(
        Effect.orDie,
        Effect.withSpan("CorpusStore.placedGames"),
      );

      return CorpusStore.of({
        saveCatalog,
        saveReleases,
        saveStudios,
        saveGenres,
        rebuildSearchIndex,
        passageTextsAfter,
        saveCommonTerms,
        passagesToEmbedAfter,
        saveEmbeddings,
        embeddingProgress,
        ingestedShards,
        saveShard,
        stats,
        gameTitles,
        passagesOf,
        placedGames,
      });
    }),
  );
}

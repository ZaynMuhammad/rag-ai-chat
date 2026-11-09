import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import {
  ArticlePassage,
  type GameDetail,
  GameRow,
  Origin,
  Pin,
  PlaceGame,
  PlaceGamesQuery,
  type PlaceGamesPage,
  Studio,
} from "./GameProtocol";
import { Qid, Scope, scopeConditions } from "./Scope";

export const SortOrder = Schema.Literals(["newest", "oldest", "title"]);
export type SortOrder = typeof SortOrder.Type;

export const BrowseQuery = Schema.Struct({
  ...Scope.fields,
  title: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))),
  sort: SortOrder,
  page: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
});
export type BrowseQuery = typeof BrowseQuery.Type;

const StringList = Schema.fromJsonString(Schema.Array(Schema.String));

export const GameSummary = Schema.Struct({
  qid: Schema.String,
  title: Schema.String,
  released: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  countries: StringList,
  subRegions: StringList,
});
export type GameSummary = typeof GameSummary.Type;

export const SubRegionCount = Schema.Struct({
  region: Schema.String,
  subRegion: Schema.String,
  games: Schema.Number,
});
export type SubRegionCount = typeof SubRegionCount.Type;

export interface BrowsePage {
  readonly games: ReadonlyArray<GameSummary>;
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

const PlaceGameRow = Schema.Struct({
  ...PlaceGame.fields,
  genres: StringList,
});

export class GameNotFound extends Schema.TaggedError<GameNotFound>()(
  "GameNotFound",
  { qid: Schema.String },
) {}

export const pageSize = 24;
export const placePageSize = 50;

const isQid = Schema.is(Qid);

export class GameCatalog extends Context.Service<
  GameCatalog,
  {
    browse(query: BrowseQuery): Effect.Effect<BrowsePage>;
    readonly subRegions: Effect.Effect<ReadonlyArray<SubRegionCount>>;
    readonly pins: Effect.Effect<ReadonlyArray<Pin>>;
    placeGames(query: PlaceGamesQuery): Effect.Effect<PlaceGamesPage>;
    game(qid: string): Effect.Effect<GameDetail, GameNotFound>;
  }
>()("rag-ai-chat/games/GameCatalog") {
  static readonly layer = Layer.effect(
    GameCatalog,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const hasText = sql`EXISTS (SELECT 1 FROM passages WHERE passages.game_qid = games.qid)`;

      const pinHasText = sql`pins.game_qid IN (SELECT game_qid FROM passages)`;

      const browseConditions = (query: BrowseQuery) =>
        sql.and([
          hasText,
          ...scopeConditions(sql, query),
          ...(query.title === undefined || query.title.trim() === ""
            ? []
            : [
                sql`instr(lower(games.title), lower(${query.title.trim()})) > 0`,
              ]),
        ]);

      const orderBy = (sort: SortOrder) =>
        sort === "title"
          ? sql`games.title COLLATE NOCASE`
          : sort === "oldest"
            ? sql`games.released IS NULL, games.released, games.title COLLATE NOCASE`
            : sql`games.released IS NULL, games.released DESC, games.title COLLATE NOCASE`;

      const findGames = SqlSchema.findAll({
        Request: BrowseQuery,
        Result: GameSummary,
        execute: (query) => sql`
          SELECT
            games.qid, games.title, games.released, games.description,
            (SELECT json_group_array(DISTINCT country) FROM origins WHERE game_qid = games.qid) AS countries,
            (SELECT json_group_array(DISTINCT sub_region) FROM origins WHERE game_qid = games.qid) AS subRegions
          FROM games
          WHERE ${browseConditions(query)}
          ORDER BY ${orderBy(query.sort)}
          LIMIT ${pageSize} OFFSET ${(query.page - 1) * pageSize}
        `,
      });

      const countGames = SqlSchema.findOne({
        Request: BrowseQuery,
        Result: Schema.Struct({ total: Schema.Number }),
        execute: (query) => sql`
          SELECT COUNT(*) AS total FROM games WHERE ${browseConditions(query)}
        `,
      });

      const browse = Effect.fn("GameCatalog.browse")(function* (
        query: BrowseQuery,
      ) {
        const [games, { total }] = yield* Effect.all([
          findGames(query),
          countGames(query),
        ]);
        return {
          games,
          total,
          page: query.page,
          pageCount: Math.max(1, Math.ceil(total / pageSize)),
        };
      }, Effect.orDie);

      const subRegions = yield* SqlSchema.findAll({
        Request: Schema.Void,
        Result: SubRegionCount,
        execute: () => sql`
          SELECT origins.region, origins.sub_region AS subRegion, COUNT(DISTINCT games.qid) AS games
          FROM origins JOIN games ON games.qid = origins.game_qid
          WHERE ${hasText}
          GROUP BY origins.region, origins.sub_region
          ORDER BY origins.region, games DESC
        `,
      })(undefined).pipe(
        Effect.orDie,
        Effect.withSpan("GameCatalog.subRegions"),
        Effect.cached,
      );

      const pins = yield* SqlSchema.findAll({
        Request: Schema.Void,
        Result: Pin,
        execute: () => sql`
          SELECT
            place_qid AS placeQid, place_label AS label, kind, latitude, longitude,
            COUNT(DISTINCT game_qid) AS games
          FROM pins
          WHERE ${pinHasText}
          GROUP BY place_qid, kind
          ORDER BY games DESC, placeQid
        `,
      })(undefined).pipe(
        Effect.orDie,
        Effect.withSpan("GameCatalog.pins"),
        Effect.cached,
      );

      const findPlaceGames = SqlSchema.findAll({
        Request: PlaceGamesQuery,
        Result: PlaceGameRow,
        execute: (query) => sql`
          SELECT
            games.qid, games.title, games.released,
            (SELECT json_group_array(label) FROM (
              SELECT label FROM genres WHERE genres.game_qid = games.qid ORDER BY label
            )) AS genres
          FROM games
          WHERE games.qid IN (
            SELECT game_qid FROM pins WHERE place_qid = ${query.placeQid} AND ${pinHasText}
          )
          ORDER BY ${orderBy("newest")}
          LIMIT ${placePageSize} OFFSET ${(query.page - 1) * placePageSize}
        `,
      });

      const countPlaceGames = SqlSchema.findOne({
        Request: Qid,
        Result: Schema.Struct({ total: Schema.Number }),
        execute: (placeQid) => sql`
          SELECT COUNT(DISTINCT game_qid) AS total FROM pins
          WHERE place_qid = ${placeQid} AND ${pinHasText}
        `,
      });

      const placeGames = Effect.fn("GameCatalog.placeGames")(function* (
        query: PlaceGamesQuery,
      ) {
        const [games, { total }] = yield* Effect.all([
          findPlaceGames(query),
          countPlaceGames(query.placeQid),
        ]);
        return {
          games,
          total,
          page: query.page,
          pageCount: Math.max(1, Math.ceil(total / placePageSize)),
        };
      }, Effect.orDie);

      const findGame = SqlSchema.findOneOption({
        Request: Qid,
        Result: GameRow,
        execute: (qid) => sql`
          SELECT qid, title, released, description, url, revision_id AS revisionId
          FROM games WHERE qid = ${qid}
        `,
      });

      const findOrigins = SqlSchema.findAll({
        Request: Qid,
        Result: Origin,
        execute: (qid) => sql`
          SELECT place_label AS placeLabel, country, region, sub_region AS subRegion
          FROM origins WHERE game_qid = ${qid} ORDER BY country, place_label
        `,
      });

      const findStudios = SqlSchema.findAll({
        Request: Qid,
        Result: Studio,
        execute: (qid) => sql`
          SELECT developer_label AS developer, place_label AS place
          FROM studios WHERE game_qid = ${qid} ORDER BY developer_label
        `,
      });

      const findGenres = SqlSchema.findAll({
        Request: Qid,
        Result: Schema.Struct({ label: Schema.String }),
        execute: (qid) => sql`
          SELECT label FROM genres WHERE game_qid = ${qid} ORDER BY label
        `,
      });

      const findPassages = SqlSchema.findAll({
        Request: Qid,
        Result: ArticlePassage,
        execute: (qid) => sql`
          SELECT id, heading, text FROM passages WHERE game_qid = ${qid} ORDER BY ordinal
        `,
      });

      const game = Effect.fn("GameCatalog.game")(function* (qid: string) {
        const notFound = new GameNotFound({ qid });
        if (!isQid(qid)) return yield* notFound;
        const row = yield* findGame(qid).pipe(Effect.orDie);
        if (Option.isNone(row)) return yield* notFound;
        const [origins, studios, genres, passages] = yield* Effect.all([
          findOrigins(qid),
          findStudios(qid),
          findGenres(qid),
          findPassages(qid),
        ]).pipe(Effect.orDie);
        return {
          ...row.value,
          origins,
          studios,
          genres: genres.map((genre) => genre.label),
          passages,
        };
      });

      return GameCatalog.of({ browse, subRegions, pins, placeGames, game });
    }),
  );
}

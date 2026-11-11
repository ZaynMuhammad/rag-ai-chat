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
import { Qid } from "./Scope";

const PlaceGameRow = Schema.Struct({
  ...PlaceGame.fields,
  genres: Schema.fromJsonString(Schema.Array(Schema.String)),
});

export class GameNotFound extends Schema.TaggedError<GameNotFound>()(
  "GameNotFound",
  { qid: Schema.String },
) {}

export const placePageSize = 50;

const isQid = Schema.is(Qid);

export class GameCatalog extends Context.Service<
  GameCatalog,
  {
    readonly pins: Effect.Effect<ReadonlyArray<Pin>>;
    placeGames(query: PlaceGamesQuery): Effect.Effect<PlaceGamesPage>;
    game(qid: string): Effect.Effect<GameDetail, GameNotFound>;
  }
>()("rag-ai-chat/games/GameCatalog") {
  static readonly layer = Layer.effect(
    GameCatalog,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const pinHasText = sql`pins.game_qid IN (SELECT game_qid FROM passages)`;
      const pinIs = (query: PlaceGamesQuery) =>
        sql`place_qid = ${query.placeQid} AND kind = ${query.kind} AND ${pinHasText}`;

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
            SELECT game_qid FROM pins WHERE ${pinIs(query)}
          )
          ORDER BY games.released IS NULL, games.released DESC, games.title COLLATE NOCASE
          LIMIT ${placePageSize} OFFSET ${(query.page - 1) * placePageSize}
        `,
      });

      const countPlaceGames = SqlSchema.findOne({
        Request: PlaceGamesQuery,
        Result: Schema.Struct({ total: Schema.Number }),
        execute: (query) => sql`
          SELECT COUNT(DISTINCT game_qid) AS total FROM pins WHERE ${pinIs(query)}
        `,
      });

      const placeGames = Effect.fn("GameCatalog.placeGames")(function* (
        query: PlaceGamesQuery,
      ) {
        const [games, { total }] = yield* Effect.all([
          findPlaceGames(query),
          countPlaceGames(query),
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

      return GameCatalog.of({ pins, placeGames, game });
    }),
  );
}

import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
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

export const Origin = Schema.Struct({
  placeLabel: Schema.String,
  country: Schema.String,
  region: Schema.String,
  subRegion: Schema.String,
});

export const ArticlePassage = Schema.Struct({
  id: Schema.String,
  heading: Schema.String,
  text: Schema.String,
});

const GameRow = Schema.Struct({
  qid: Schema.String,
  title: Schema.String,
  released: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  revisionId: Schema.NullOr(Schema.Number),
});

export interface GameDetail extends Schema.Schema.Type<typeof GameRow> {
  readonly origins: ReadonlyArray<typeof Origin.Type>;
  readonly passages: ReadonlyArray<typeof ArticlePassage.Type>;
}

export interface BrowsePage {
  readonly games: ReadonlyArray<GameSummary>;
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

export class GameNotFound extends Schema.TaggedError<GameNotFound>()(
  "GameNotFound",
  { qid: Schema.String },
) {}

export const pageSize = 24;

const isQid = Schema.is(Qid);

export class GameCatalog extends Context.Service<
  GameCatalog,
  {
    browse(query: BrowseQuery): Effect.Effect<BrowsePage>;
    readonly subRegions: Effect.Effect<ReadonlyArray<SubRegionCount>>;
    game(qid: string): Effect.Effect<GameDetail, GameNotFound>;
  }
>()("rag-ai-chat/games/GameCatalog") {
  static readonly layer = Layer.effect(
    GameCatalog,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const hasText = sql`EXISTS (SELECT 1 FROM passages WHERE passages.game_qid = games.qid)`;

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
        const [origins, passages] = yield* Effect.all([
          findOrigins(qid),
          findPassages(qid),
        ]).pipe(Effect.orDie);
        return { ...row.value, origins, passages };
      });

      return GameCatalog.of({ browse, subRegions, game });
    }),
  );
}

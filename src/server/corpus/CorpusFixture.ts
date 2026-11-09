import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { migrations } from "@/corpus/CorpusStore";

export interface FixtureGame {
  readonly qid: string;
  readonly title: string;
  readonly released?: string;
  readonly description?: string;
  readonly origins: ReadonlyArray<{
    readonly iso2: string;
    readonly country: string;
    readonly region: string;
    readonly subRegion: string;
  }>;
  readonly passages: ReadonlyArray<{
    readonly heading: string;
    readonly text: string;
  }>;
}

export const japan = {
  iso2: "JP",
  country: "Japan",
  region: "Asia",
  subRegion: "Eastern Asia",
};
export const unitedStates = {
  iso2: "US",
  country: "United States of America",
  region: "Americas",
  subRegion: "Northern America",
};
export const unitedKingdom = {
  iso2: "GB",
  country: "United Kingdom",
  region: "Europe",
  subRegion: "Northern Europe",
};
export const sovietUnion = {
  iso2: "SU",
  country: "Soviet Union",
  region: "Europe",
  subRegion: "Eastern Europe",
};

const insertGame = Effect.fn(function* (game: FixtureGame) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO games ${sql.insert({
    qid: game.qid,
    title: game.title,
    url: `https://en.wikipedia.org/wiki/${game.title.replaceAll(" ", "_")}`,
    revision_id: 1000,
    description: game.description ?? null,
    released: game.released ?? null,
    release_year:
      game.released === undefined ? null : Number(game.released.slice(0, 4)),
  })}`;
  for (const origin of game.origins) {
    yield* sql`INSERT INTO origins ${sql.insert({
      game_qid: game.qid,
      place_qid: `place-${origin.iso2}`,
      place_label: origin.country,
      iso2: origin.iso2,
      country: origin.country,
      region: origin.region,
      sub_region: origin.subRegion,
      latitude: 0,
      longitude: 0,
      source: "country_of_origin",
    })}`;
  }
  for (const [ordinal, passage] of game.passages.entries()) {
    yield* sql`INSERT INTO passages ${sql.insert({
      id: `${game.qid}#${ordinal}`,
      game_qid: game.qid,
      ordinal,
      heading: passage.heading,
      section_path: "[]",
      text: passage.text,
      token_estimate: passage.text.split(" ").length,
    })}`;
  }
});

export const corpusFixture = (games: ReadonlyArray<FixtureGame>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Effect.forEach(games, insertGame, { discard: true });
      yield* sql`INSERT INTO passages_fts (passages_fts) VALUES ('rebuild')`;
    }),
  ).pipe(
    Layer.provideMerge(
      SqliteMigrator.layer({
        loader: SqliteMigrator.fromRecord(migrations),
      }),
    ),
    Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
    Layer.orDie,
  );

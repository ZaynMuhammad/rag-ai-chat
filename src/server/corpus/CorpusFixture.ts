import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { CorpusStore, migrations } from "@/corpus/CorpusStore";
import { Embedder, passageInput } from "@/server/search/Embedder";
import { codesToBlob, quantize } from "@/server/search/Vectors";

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
  readonly studios?: ReadonlyArray<FixtureStudio>;
  readonly genres?: ReadonlyArray<string>;
  readonly passages: ReadonlyArray<{
    readonly heading: string;
    readonly text: string;
  }>;
}

export interface FixtureStudio {
  readonly developer: string;
  readonly placeQid: string;
  readonly place: string;
}

export const placeQidOf = (iso2: string) =>
  `Q${iso2.charCodeAt(0)}${iso2.charCodeAt(1)}`;

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
      place_qid: placeQidOf(origin.iso2),
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
  for (const studio of game.studios ?? []) {
    yield* sql`INSERT INTO studios ${sql.insert({
      game_qid: game.qid,
      developer_qid: `developer-${studio.developer}`,
      developer_label: studio.developer,
      place_qid: studio.placeQid,
      place_label: studio.place,
      latitude: 0,
      longitude: 0,
    })}`;
  }
  for (const genre of game.genres ?? []) {
    yield* sql`INSERT INTO genres ${sql.insert({
      game_qid: game.qid,
      genre_qid: `genre-${genre}`,
      label: genre,
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

export const embedFixturePassages = (skip: ReadonlyArray<string> = []) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const store = yield* CorpusStore;
      const embedder = yield* Embedder;
      const passages = (yield* store.passagesToEmbedAfter(0, 10_000)).filter(
        (passage) => !skip.includes(passage.id),
      );
      const vectors = yield* embedder.embedPassages(passages.map(passageInput));
      yield* store.saveEmbeddings(
        passages.flatMap((passage, index) => {
          const vector = vectors[index];
          if (vector === undefined) return [];
          const { codes, scale } = quantize(vector);
          return [{ passageId: passage.id, vector: codesToBlob(codes), scale }];
        }),
      );
    }),
  ).pipe(Layer.provide(CorpusStore.layer));

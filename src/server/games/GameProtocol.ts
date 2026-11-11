import { Schema } from "effect";
import { Qid } from "./Scope";

export const Pin = Schema.Struct({
  placeQid: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(["studio", "country"]),
  latitude: Schema.Number,
  longitude: Schema.Number,
  games: Schema.Number,
});
export type Pin = typeof Pin.Type;

export const PlaceGame = Schema.Struct({
  qid: Schema.String,
  title: Schema.String,
  released: Schema.NullOr(Schema.String),
  genres: Schema.Array(Schema.String),
});
export type PlaceGame = typeof PlaceGame.Type;

export const PlaceGamesQuery = Schema.Struct({
  placeQid: Qid,
  page: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 })),
});
export type PlaceGamesQuery = typeof PlaceGamesQuery.Type;

export const PlaceGamesPage = Schema.Struct({
  games: Schema.Array(PlaceGame),
  total: Schema.Number,
  page: Schema.Number,
  pageCount: Schema.Number,
});
export type PlaceGamesPage = typeof PlaceGamesPage.Type;

export const Studio = Schema.Struct({
  developer: Schema.String,
  place: Schema.String,
});

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

export const GameRow = Schema.Struct({
  qid: Schema.String,
  title: Schema.String,
  released: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  revisionId: Schema.NullOr(Schema.Number),
});

export const GameDetail = Schema.Struct({
  ...GameRow.fields,
  origins: Schema.Array(Origin),
  studios: Schema.Array(Studio),
  genres: Schema.Array(Schema.String),
  passages: Schema.Array(ArticlePassage),
});
export type GameDetail = typeof GameDetail.Type;

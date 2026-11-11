import { assert, describe, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  corpusFixture,
  japan,
  placeQidOf,
  sovietUnion,
  unitedKingdom,
  unitedStates,
} from "@/server/corpus/CorpusFixture";
import { GameCatalog, GameNotFound } from "./GameCatalog";

const kyoto = (developer: string) => ({
  developer,
  placeQid: "Q34600",
  place: "Kyoto",
});

const lead = (title: string) => [{ heading: title, text: `${title} lead.` }];

const fixture = corpusFixture([
  {
    qid: "Q1",
    title: "Super Mario Bros.",
    released: "1985-09-13",
    origins: [japan],
    studios: [kyoto("Nintendo")],
    genres: ["Platform game"],
    passages: lead("Super Mario Bros."),
  },
  {
    qid: "Q2",
    title: "Tetris",
    released: "1985",
    origins: [sovietUnion],
    passages: lead("Tetris"),
  },
  {
    qid: "Q3",
    title: "Doom",
    released: "1993-12-10",
    origins: [unitedStates],
    passages: lead("Doom"),
  },
  {
    qid: "Q4",
    title: "Kingdom Hearts",
    released: "2002-03-28",
    origins: [japan, unitedStates],
    studios: [
      { developer: "Square", placeQid: "Q1490", place: "Tokyo" },
      {
        developer: "Square Product Development Division 1",
        placeQid: "Q1490",
        place: "Tokyo",
      },
    ],
    genres: ["Action role-playing game", "Hack and slash"],
    passages: lead("Kingdom Hearts"),
  },
  {
    qid: "Q5",
    title: "Elite",
    origins: [unitedKingdom],
    passages: lead("Elite"),
  },
  {
    qid: "Q6",
    title: "Redirected Remaster",
    released: "2020",
    origins: [japan],
    studios: [kyoto("Nintendo")],
    passages: [],
  },
  {
    qid: "Q7",
    title: "Lemmings",
    released: "1991-02-14",
    origins: [unitedKingdom],
    studios: [
      {
        developer: "DMA Design",
        placeQid: placeQidOf(unitedKingdom.iso2),
        place: "United Kingdom",
      },
    ],
    passages: lead("Lemmings"),
  },
]);

layer(GameCatalog.layer.pipe(Layer.provideMerge(fixture)))(
  "GameCatalog",
  (it) => {
    describe("pins", () => {
      it.effect(
        "pins a game at its studio's city and falls back to its country only when no studio is known",
        () =>
          Effect.gen(function* () {
            const catalog = yield* GameCatalog;
            const pins = (yield* catalog.pins)
              .map((pin) => [pin.label, pin.kind, pin.games])
              .sort((a, b) => a.join().localeCompare(b.join()));
            assert.deepStrictEqual(pins, [
              ["Kyoto", "studio", 1],
              ["Soviet Union", "country", 1],
              ["Tokyo", "studio", 1],
              ["United Kingdom", "country", 1],
              ["United Kingdom", "studio", 1],
              ["United States of America", "country", 1],
            ]);
          }),
      );
    });

    describe("placeGames", () => {
      it.effect("lists the games with text at a place with their genres", () =>
        Effect.gen(function* () {
          const catalog = yield* GameCatalog;
          const tokyo = yield* catalog.placeGames({
            placeQid: "Q1490",
            kind: "studio",
            page: 1,
          });
          assert.deepStrictEqual(tokyo, {
            games: [
              {
                qid: "Q4",
                title: "Kingdom Hearts",
                released: "2002-03-28",
                genres: ["Action role-playing game", "Hack and slash"],
              },
            ],
            total: 1,
            page: 1,
            pageCount: 1,
          });
          const unitedStatesGames = yield* catalog.placeGames({
            placeQid: placeQidOf(unitedStates.iso2),
            kind: "country",
            page: 1,
          });
          assert.deepStrictEqual(
            unitedStatesGames.games.map((game) => [game.title, game.genres]),
            [["Doom", []]],
          );
        }),
      );

      it.effect(
        "keeps a place's studio games apart from its country fallback games",
        () =>
          Effect.gen(function* () {
            const catalog = yield* GameCatalog;
            const placeQid = placeQidOf(unitedKingdom.iso2);
            const studio = yield* catalog.placeGames({
              placeQid,
              kind: "studio",
              page: 1,
            });
            const country = yield* catalog.placeGames({
              placeQid,
              kind: "country",
              page: 1,
            });
            assert.deepStrictEqual(
              [studio.games.map((game) => game.title), studio.total],
              [["Lemmings"], 1],
            );
            assert.deepStrictEqual(
              [country.games.map((game) => game.title), country.total],
              [["Elite"], 1],
            );
          }),
      );
    });

    describe("game", () => {
      it.effect(
        "returns the article passages in reading order with its origins",
        () =>
          Effect.gen(function* () {
            const catalog = yield* GameCatalog;
            const game = yield* catalog.game("Q4");
            assert.strictEqual(game.title, "Kingdom Hearts");
            assert.deepStrictEqual(
              game.origins.map((origin) => origin.country),
              ["Japan", "United States of America"],
            );
            assert.deepStrictEqual(
              game.passages.map((passage) => passage.id),
              ["Q4#0"],
            );
            assert.deepStrictEqual(game.genres, [
              "Action role-playing game",
              "Hack and slash",
            ]);
            assert.deepStrictEqual(
              game.studios.map((studio) => studio.place),
              ["Tokyo", "Tokyo"],
            );
          }),
      );

      it.effect("fails with GameNotFound for an unknown or malformed id", () =>
        Effect.gen(function* () {
          const catalog = yield* GameCatalog;
          assert.deepStrictEqual(
            yield* Effect.flip(catalog.game("Q999")),
            new GameNotFound({ qid: "Q999" }),
          );
          assert.deepStrictEqual(
            yield* Effect.flip(catalog.game("'; DROP TABLE games")),
            new GameNotFound({ qid: "'; DROP TABLE games" }),
          );
        }),
      );
    });
  },
);

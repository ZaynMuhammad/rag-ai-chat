import { assert, describe, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  corpusFixture,
  japan,
  sovietUnion,
  unitedKingdom,
  unitedStates,
} from "@/server/corpus/CorpusFixture";
import { type BrowseQuery, GameCatalog, GameNotFound } from "./GameCatalog";

const lead = (title: string) => [{ heading: title, text: `${title} lead.` }];

const fixture = corpusFixture([
  {
    qid: "Q1",
    title: "Super Mario Bros.",
    released: "1985-09-13",
    origins: [japan],
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
    passages: [],
  },
]);

const browse = (query: Partial<BrowseQuery>) =>
  Effect.flatMap(GameCatalog, (catalog) =>
    catalog.browse({ sort: "newest", page: 1, ...query }),
  ).pipe(Effect.map((page) => page.games.map((game) => game.title)));

layer(GameCatalog.layer.pipe(Layer.provideMerge(fixture)))(
  "GameCatalog",
  (it) => {
    describe("browse", () => {
      it.effect(
        "sorts by release date, newest first, with undated games last",
        () =>
          Effect.gen(function* () {
            assert.deepStrictEqual(yield* browse({}), [
              "Kingdom Hearts",
              "Doom",
              "Super Mario Bros.",
              "Tetris",
              "Elite",
            ]);
          }),
      );

      it.effect(
        "orders a bare year before precise dates in that year, oldest first",
        () =>
          Effect.gen(function* () {
            assert.deepStrictEqual(yield* browse({ sort: "oldest" }), [
              "Tetris",
              "Super Mario Bros.",
              "Doom",
              "Kingdom Hearts",
              "Elite",
            ]);
          }),
      );

      it.effect(
        "filters by region and keeps co-productions under every region they came from",
        () =>
          Effect.gen(function* () {
            assert.deepStrictEqual(yield* browse({ region: "Asia" }), [
              "Kingdom Hearts",
              "Super Mario Bros.",
            ]);
            assert.deepStrictEqual(
              yield* browse({ subRegion: "Northern America" }),
              ["Kingdom Hearts", "Doom"],
            );
          }),
      );

      it.effect("filters by an inclusive range of release years", () =>
        Effect.gen(function* () {
          assert.deepStrictEqual(yield* browse({ from: 1985, to: 1993 }), [
            "Doom",
            "Super Mario Bros.",
            "Tetris",
          ]);
        }),
      );

      it.effect(
        "matches titles case-insensitively and hides games without article text",
        () =>
          Effect.gen(function* () {
            assert.deepStrictEqual(yield* browse({ title: "  KINGDOM " }), [
              "Kingdom Hearts",
            ]);
            assert.deepStrictEqual(yield* browse({ title: "Remaster" }), []);
          }),
      );

      it.effect("lists every country a game came from", () =>
        Effect.gen(function* () {
          const catalog = yield* GameCatalog;
          const page = yield* catalog.browse({
            sort: "title",
            page: 1,
            title: "Kingdom",
          });
          assert.deepStrictEqual(page.games[0]?.countries, [
            "Japan",
            "United States of America",
          ]);
          assert.strictEqual(page.total, 1);
        }),
      );
    });

    describe("subRegions", () => {
      it.effect("counts games with text once per sub-region", () =>
        Effect.gen(function* () {
          const catalog = yield* GameCatalog;
          const asia = (yield* catalog.subRegions).filter(
            (row) => row.region === "Asia",
          );
          assert.deepStrictEqual(asia, [
            { region: "Asia", subRegion: "Eastern Asia", games: 2 },
          ]);
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

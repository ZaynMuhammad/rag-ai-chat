import { describe, expect, it } from "@effect/vitest";
import { buildCatalog, parsePoint } from "./Catalog";

const japan = {
  qid: "Q17",
  label: "Japan",
  iso2: "JP",
  coordinates: "Point(136 35)",
};
const unitedStates = {
  qid: "Q30",
  label: "United States",
  iso2: "US",
  coordinates: "Point(-98.5795 39.828175)",
};

describe("buildCatalog", () => {
  it("places a game at every origin and tags each with its UN M49 region", () => {
    const catalog = buildCatalog(
      [
        {
          gameQid: "Q1",
          title: "Co-production",
          originQid: "Q30",
          source: "country_of_origin",
        },
        {
          gameQid: "Q1",
          title: "Co-production",
          originQid: "Q17",
          source: "country_of_origin",
        },
      ],
      [japan, unitedStates],
    );

    expect(catalog.games).toHaveLength(1);
    expect(
      catalog.games[0]!.origins.map((origin) => [
        origin.iso2,
        origin.region,
        origin.subRegion,
      ]),
    ).toEqual([
      ["JP", "Asia", "Eastern Asia"],
      ["US", "Americas", "Northern America"],
    ]);
  });

  it("keeps the more specific place but files it under its sovereign country's region", () => {
    const catalog = buildCatalog(
      [
        {
          gameQid: "Q1",
          title: "Elite",
          originQid: "Q21",
          source: "country_of_origin",
        },
      ],
      [
        {
          qid: "Q21",
          label: "England",
          iso2: "GB",
          coordinates: "Point(-1 53)",
        },
      ],
    );

    expect(catalog.games[0]!.origins[0]).toMatchObject({
      placeLabel: "England",
      country: "United Kingdom of Great Britain and Northern Ireland",
      subRegion: "Northern Europe",
      latitude: 53,
      longitude: -1,
    });
  });

  it("files historical states such as the Soviet Union under a region", () => {
    const catalog = buildCatalog(
      [
        {
          gameQid: "Q71910",
          title: "Tetris",
          originQid: "Q15180",
          source: "country_of_origin",
        },
      ],
      [
        {
          qid: "Q15180",
          label: "Soviet Union",
          iso2: "SU",
          coordinates: "Point(90 65)",
        },
      ],
    );

    expect(catalog.games[0]!.origins[0]).toMatchObject({
      country: "Soviet Union",
      subRegion: "Eastern Europe",
    });
  });

  it("reports games whose only origin cannot be placed instead of guessing", () => {
    const catalog = buildCatalog(
      [
        {
          gameQid: "Q1",
          title: "Somewhere",
          originQid: "Q29520",
          source: "country_of_origin",
        },
      ],
      [
        {
          qid: "Q29520",
          label: "China",
          iso2: undefined,
          coordinates: "Point(105 35)",
        },
      ],
    );

    expect(catalog.games).toEqual([]);
    expect(catalog.unplacedGameQids).toEqual(["Q1"]);
    expect(catalog.unresolvedPlaceQids).toEqual(["Q29520"]);
  });

  it("picks the same coordinates every run when a place has several", () => {
    const rows = [
      { ...japan, coordinates: "Point(139 36)" },
      { ...japan, coordinates: "Point(136 35)" },
    ];
    const games = [
      {
        gameQid: "Q1",
        title: "Pac-Man",
        originQid: "Q17",
        source: "country_of_origin" as const,
      },
    ];

    expect(buildCatalog(games, rows).games).toEqual(
      buildCatalog(games, [...rows].reverse()).games,
    );
    expect(buildCatalog(games, rows).games[0]!.origins[0]).toMatchObject({
      longitude: 136,
      latitude: 35,
    });
  });
});

describe("parsePoint", () => {
  it("reads Wikidata's longitude-first WKT points", () => {
    expect(parsePoint("Point(-98.5795 39.828175)")).toEqual({
      longitude: -98.5795,
      latitude: 39.828175,
    });
    expect(parsePoint("not a point")).toBeUndefined();
  });
});

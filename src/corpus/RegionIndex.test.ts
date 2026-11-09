import { describe, expect, it } from "@effect/vitest";
import { groupByRegion, type PlacedGame } from "./RegionIndex";

const game = (
  overrides: Partial<PlacedGame> & Pick<PlacedGame, "qid" | "title">,
): PlacedGame => ({
  url: null,
  passages: 3,
  placeLabel: "Japan",
  iso2: "JP",
  country: "Japan",
  region: "Asia",
  subRegion: "Eastern Asia",
  latitude: 35,
  longitude: 136,
  ...overrides,
});

const england = {
  placeLabel: "England",
  iso2: "GB",
  country: "United Kingdom",
  region: "Europe",
  subRegion: "Northern Europe",
  latitude: 53,
  longitude: -1,
};
const unitedKingdom = {
  ...england,
  placeLabel: "United Kingdom",
  latitude: 54,
  longitude: -2,
};

describe("groupByRegion", () => {
  it("orders regions, sub-regions and countries by how many games they hold", () => {
    const regions = groupByRegion([
      game({ qid: "Q1", title: "Pac-Man" }),
      game({ qid: "Q2", title: "Elite", ...england }),
      game({ qid: "Q3", title: "Lemmings", ...unitedKingdom }),
      game({ qid: "Q4", title: "Worms", ...england }),
    ]);

    expect(regions.map((region) => [region.region, region.gameCount])).toEqual([
      ["Europe", 3],
      ["Asia", 1],
    ]);
  });

  it("anchors a country at its most common origin point while each game keeps its own", () => {
    const [europe] = groupByRegion([
      game({ qid: "Q2", title: "Elite", ...england }),
      game({ qid: "Q3", title: "Lemmings", ...unitedKingdom }),
      game({ qid: "Q4", title: "Worms", ...england }),
    ]);
    const [uk] = europe!.subRegions[0]!.countries;

    expect([uk!.latitude, uk!.longitude]).toEqual([53, -1]);
    expect(uk!.games.map((entry) => [entry.title, entry.latitude])).toEqual([
      ["Elite", 53],
      ["Lemmings", 54],
      ["Worms", 53],
    ]);
  });

  it("counts a co-production once per region but lists it under each country", () => {
    const regions = groupByRegion([
      game({ qid: "Q5", title: "Co-op", ...england }),
      game({
        qid: "Q5",
        title: "Co-op",
        iso2: "FR",
        country: "France",
        region: "Europe",
        subRegion: "Western Europe",
      }),
    ]);

    expect(regions[0]!.gameCount).toBe(1);
    expect(
      regions[0]!.subRegions
        .map((subRegion) => subRegion.countries[0]!.country)
        .sort(),
    ).toEqual(["France", "United Kingdom"]);
  });

  it("falls back to the Wikipedia title URL for games without article text", () => {
    const [asia] = groupByRegion([
      game({ qid: "Q6", title: "Space Invaders" }),
    ]);

    expect(asia!.subRegions[0]!.countries[0]!.games[0]!.url).toBe(
      "https://en.wikipedia.org/wiki/Space_Invaders",
    );
  });
});

import { describe, expect, it } from "@effect/vitest";
import { type StudioRow, studioLocations } from "./Studios";

const row = (overrides: Partial<StudioRow>): StudioRow => ({
  gameQid: "Q1",
  developerQid: "D1",
  developerLabel: "Nintendo",
  placeQid: "Q34600",
  placeLabel: "Kyoto",
  coordinates: "Point(135.768 35.0117)",
  placeIsCountry: false,
  ...overrides,
});

describe("studioLocations", () => {
  it("places each developer of a game at its headquarters city", () => {
    const studios = studioLocations([
      row({}),
      row({
        developerQid: "D2",
        developerLabel: "Square",
        placeQid: "Q1490",
        placeLabel: "Tokyo",
        coordinates: "Point(139.69 35.68)",
      }),
    ]);

    expect(
      studios.map((studio) => [
        studio.developerLabel,
        studio.placeLabel,
        studio.latitude,
        studio.longitude,
      ]),
    ).toEqual([
      ["Nintendo", "Kyoto", 35.0117, 135.768],
      ["Square", "Tokyo", 35.68, 139.69],
    ]);
  });

  it("drops a headquarters that is a whole country, so the game falls back to its country pin", () => {
    expect(
      studioLocations([
        row({ placeQid: "Q17", placeLabel: "Japan", placeIsCountry: true }),
      ]),
    ).toEqual([]);
  });

  it("keeps one place per developer when Wikidata lists several headquarters", () => {
    const studios = studioLocations([
      row({ placeQid: "Q90", placeLabel: "Paris" }),
      row({ placeQid: "Q84", placeLabel: "London" }),
      row({ placeQid: "Q90", placeLabel: "Paris" }),
    ]);

    expect(studios.map((studio) => studio.placeLabel)).toEqual(["London"]);
  });

  it("skips rows it cannot label or place on the map", () => {
    expect(
      studioLocations([
        row({ coordinates: "Point(not a point)" }),
        row({ developerQid: "D2", developerLabel: undefined }),
        row({ developerQid: "D3", placeLabel: undefined }),
      ]),
    ).toEqual([]);
  });
});

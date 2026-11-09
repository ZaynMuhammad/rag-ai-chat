import { describe, expect, it } from "@effect/vitest";
import { earliestReleases } from "./ReleaseDate";

const row = (gameQid: string, date: string, precision: number) => ({
  gameQid,
  date,
  precision,
});

describe("earliestReleases", () => {
  it("keeps each game's first release, truncated to the precision Wikidata states", () => {
    const releases = earliestReleases([
      row("Q1", "2006-06-29T00:00:00Z", 11),
      row("Q1", "2006-09-14T00:00:00Z", 11),
      row("Q2", "1979-01-01T00:00:00Z", 9),
      row("Q3", "1971-11-01T00:00:00Z", 10),
    ]);

    expect(releases).toEqual([
      { gameQid: "Q1", released: "2006-06-29", year: 2006 },
      { gameQid: "Q2", released: "1979", year: 1979 },
      { gameQid: "Q3", released: "1971-11", year: 1971 },
    ]);
  });

  it("prefers a precise date over a bare year within the same first year", () => {
    const releases = earliestReleases([
      row("Q1", "1985-01-01T00:00:00Z", 9),
      row("Q1", "1985-09-13T00:00:00Z", 11),
      row("Q1", "1986-02-21T00:00:00Z", 11),
    ]);

    expect(releases).toEqual([
      { gameQid: "Q1", released: "1985-09-13", year: 1985 },
    ]);
  });

  it("ignores decade-level and malformed dates rather than guessing a year", () => {
    const releases = earliestReleases([
      row("Q1", "1990-01-01T00:00:00Z", 8),
      row("Q2", "-0500-01-01T00:00:00Z", 9),
      row("Q3", "2001-03-21T00:00:00Z", 11),
    ]);

    expect(releases).toEqual([
      { gameQid: "Q3", released: "2001-03-21", year: 2001 },
    ]);
  });

  it("sorts truncated dates in release order as plain strings", () => {
    const released = earliestReleases([
      row("Q1", "1985-09-13T00:00:00Z", 11),
      row("Q2", "1985-01-01T00:00:00Z", 9),
      row("Q3", "1985-06-01T00:00:00Z", 10),
    ]).map((release) => release.released);

    expect(released.toSorted()).toEqual(["1985", "1985-06", "1985-09-13"]);
  });
});

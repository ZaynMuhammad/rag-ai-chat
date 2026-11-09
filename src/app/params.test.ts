import { assert, describe, it } from "@effect/vitest";
import { browseQueryFromParams, queryString } from "./params";

describe("browseQueryFromParams", () => {
  it("reads a sub-region, a year range, a sort, and a page from the URL", () => {
    assert.deepStrictEqual(
      browseQueryFromParams({
        area: "Asia|Eastern Asia",
        from: "1985",
        to: "1999",
        sort: "oldest",
        page: "3",
      }),
      {
        region: "Asia",
        subRegion: "Eastern Asia",
        from: 1985,
        to: 1999,
        sort: "oldest",
        page: 3,
      },
    );
  });

  it("drops values that are malformed or out of range instead of failing the page", () => {
    assert.deepStrictEqual(
      browseQueryFromParams({
        from: "1850",
        to: "soon",
        sort: "random",
        page: "-2",
        title: "  ",
      }),
      { sort: "newest", page: 1 },
    );
  });

  it("round-trips through the query string it builds", () => {
    const query = browseQueryFromParams({
      area: "Europe",
      title: "elite",
      page: "2",
    });
    assert.deepStrictEqual(
      browseQueryFromParams(
        Object.fromEntries(new URLSearchParams(queryString(query))),
      ),
      query,
    );
  });
});

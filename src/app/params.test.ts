import { assert, describe, it } from "@effect/vitest";
import { scopeFromParams } from "./params";

describe("scopeFromParams", () => {
  it("reads a sub-region and a year range from the URL", () => {
    assert.deepStrictEqual(
      scopeFromParams({ area: "Asia|Eastern Asia", from: "1985", to: "1999" }),
      { region: "Asia", subRegion: "Eastern Asia", from: 1985, to: 1999 },
    );
  });

  it("drops values that are malformed or out of range instead of failing the page", () => {
    assert.deepStrictEqual(
      scopeFromParams({ area: " ", from: "1850", to: "soon" }),
      {},
    );
  });
});

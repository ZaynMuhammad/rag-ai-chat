import { assert, describe, it } from "@effect/vitest";
import { formatReleased } from "./release";

describe("formatReleased", () => {
  it("shows only the precision Wikidata gave", () => {
    assert.strictEqual(formatReleased("1985"), "1985");
    assert.strictEqual(formatReleased("1971-11"), "Nov 1971");
    assert.strictEqual(formatReleased("2006-06-09"), "9 Jun 2006");
    assert.strictEqual(formatReleased(null), "Undated");
  });
});

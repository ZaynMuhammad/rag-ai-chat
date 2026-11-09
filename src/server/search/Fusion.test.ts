import { assert, describe, it } from "@effect/vitest";
import { reciprocalRankFusion } from "./Fusion";

const fuse = (rankings: ReadonlyArray<ReadonlyArray<string>>, k?: number) =>
  reciprocalRankFusion(rankings, (id) => id, k);

describe("reciprocalRankFusion", () => {
  it("ranks a passage both lists agree on above passages only one list found", () => {
    assert.deepStrictEqual(
      fuse([
        ["a", "shared", "b"],
        ["c", "shared", "d"],
      ]),
      ["shared", "a", "c", "b", "d"],
    );
  });

  it("sums 1 / (k + rank) across lists, so two middling ranks can beat one top rank", () => {
    const k = 60;
    const onlyFirst = 1 / (k + 1);
    const inBoth = 1 / (k + 3) + 1 / (k + 3);
    assert.isAbove(inBoth, onlyFirst);
    assert.deepStrictEqual(
      fuse(
        [
          ["top", "x", "both"],
          ["y", "z", "both"],
        ],
        k,
      ).slice(0, 2),
      ["both", "top"],
    );
  });

  it("lets a small k favour the top of each list over agreement", () => {
    assert.deepStrictEqual(
      fuse(
        [
          ["top", "x", "both"],
          ["y", "z", "both"],
        ],
        0,
      ).slice(0, 2),
      ["top", "y"],
    );
  });

  it("breaks equal scores by best single rank, then by the earlier list", () => {
    assert.deepStrictEqual(
      fuse([
        ["lexical", "a"],
        ["semantic", "b"],
      ]),
      ["lexical", "semantic", "a", "b"],
    );
    assert.deepStrictEqual(
      fuse([
        ["p", "q"],
        ["q", "p"],
      ]),
      ["p", "q"],
    );
  });

  it("counts a passage once per list and keeps the first copy it saw", () => {
    const fused = reciprocalRankFusion(
      [[{ id: "a", from: "lexical" }], [{ id: "a", from: "semantic" }]],
      (item) => item.id,
    );
    assert.deepStrictEqual(fused, [{ id: "a", from: "lexical" }]);
  });

  it("returns nothing for no rankings", () => {
    assert.deepStrictEqual(fuse([]), []);
    assert.deepStrictEqual(fuse([[], []]), []);
  });
});

import { describe, expect, it } from "@effect/vitest";
import {
  articleRecallAtK,
  mean,
  passageHitAtK,
  reciprocalRank,
} from "./RetrievalMetrics";

const ranking = [
  { id: "A#0", gameQid: "A" },
  { id: "B#2", gameQid: "B" },
  { id: "A#4", gameQid: "A" },
  { id: "C#1", gameQid: "C" },
];

const judgement = {
  goldPassageIds: new Set(["A#4", "C#1"]),
  goldGameQids: new Set(["A", "C"]),
};

describe("retrieval metrics", () => {
  it("counts a passage hit only when an evidence passage is inside the cutoff", () => {
    expect(passageHitAtK(ranking, judgement, 2)).toBe(false);
    expect(passageHitAtK(ranking, judgement, 3)).toBe(true);
  });

  it("measures how many gold articles a multi-hop question saw by the cutoff", () => {
    expect(articleRecallAtK(ranking, judgement, 2)).toBe(0.5);
    expect(articleRecallAtK(ranking, judgement, 4)).toBe(1);
  });

  it("scores the rank of the first evidence passage, and zero when none is retrieved", () => {
    expect(reciprocalRank(ranking, judgement)).toBeCloseTo(1 / 3);
    expect(reciprocalRank(ranking.slice(0, 2), judgement)).toBe(0);
  });

  it("averages per-question scores", () => {
    expect(mean([1, 0, 0.5])).toBe(0.5);
    expect(mean([])).toBe(0);
  });
});

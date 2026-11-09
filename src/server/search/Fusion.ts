export const defaultFusionK = 60;

interface Fused<A> {
  readonly item: A;
  score: number;
  bestRank: number;
}

export const reciprocalRankFusion = <A>(
  rankings: ReadonlyArray<ReadonlyArray<A>>,
  keyOf: (item: A) => string,
  k: number = defaultFusionK,
): ReadonlyArray<A> => {
  const fused = new Map<string, Fused<A>>();
  for (const ranking of rankings) {
    for (const [index, item] of ranking.entries()) {
      const rank = index + 1;
      const entry = fused.get(keyOf(item));
      if (entry === undefined) {
        fused.set(keyOf(item), { item, score: 1 / (k + rank), bestRank: rank });
      } else {
        entry.score += 1 / (k + rank);
        entry.bestRank = Math.min(entry.bestRank, rank);
      }
    }
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.bestRank - b.bestRank)
    .map((entry) => entry.item);
};

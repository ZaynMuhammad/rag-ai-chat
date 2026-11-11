export interface RetrievedPassage {
  readonly id: string;
  readonly gameQid: string;
}

export interface Judgement {
  readonly goldPassageIds: ReadonlySet<string>;
  readonly goldGameQids: ReadonlySet<string>;
}

const topK = (ranking: ReadonlyArray<RetrievedPassage>, k: number) =>
  ranking.slice(0, k);

export const passageHitAtK = (
  ranking: ReadonlyArray<RetrievedPassage>,
  judgement: Judgement,
  k: number,
) =>
  topK(ranking, k).some((passage) => judgement.goldPassageIds.has(passage.id));

export const articleRecallAtK = (
  ranking: ReadonlyArray<RetrievedPassage>,
  judgement: Judgement,
  k: number,
) => {
  if (judgement.goldGameQids.size === 0) return 0;
  const found = new Set(topK(ranking, k).map((passage) => passage.gameQid));
  return (
    [...judgement.goldGameQids].filter((qid) => found.has(qid)).length /
    judgement.goldGameQids.size
  );
};

export const reciprocalRank = (
  ranking: ReadonlyArray<RetrievedPassage>,
  judgement: Judgement,
) => {
  const index = ranking.findIndex((passage) =>
    judgement.goldPassageIds.has(passage.id),
  );
  return index === -1 ? 0 : 1 / (index + 1);
};

export const mean = (values: ReadonlyArray<number>) =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;

export interface ReleaseDateRow {
  readonly gameQid: string;
  readonly date: string;
  readonly precision: number;
}

export interface Release {
  readonly gameQid: string;
  readonly released: string;
  readonly year: number;
}

const precisionLength = new Map([
  [9, "YYYY".length],
  [10, "YYYY-MM".length],
  [11, "YYYY-MM-DD".length],
]);

const isoDate = /^\d{4}-\d{2}-\d{2}T/;

const toRelease = (row: ReleaseDateRow): Release | undefined => {
  const length = precisionLength.get(row.precision);
  if (length === undefined || !isoDate.test(row.date)) return undefined;
  return {
    gameQid: row.gameQid,
    released: row.date.slice(0, length),
    year: Number(row.date.slice(0, 4)),
  };
};

const isEarlier = (candidate: Release, current: Release) =>
  candidate.year !== current.year
    ? candidate.year < current.year
    : candidate.released.length !== current.released.length
      ? candidate.released.length > current.released.length
      : candidate.released < current.released;

export const earliestReleases = (
  rows: ReadonlyArray<ReleaseDateRow>,
): ReadonlyArray<Release> => {
  const earliest = new Map<string, Release>();
  for (const row of rows) {
    const release = toRelease(row);
    if (release === undefined) continue;
    const current = earliest.get(release.gameQid);
    if (current === undefined || isEarlier(release, current)) {
      earliest.set(release.gameQid, release);
    }
  }
  return [...earliest.values()];
};

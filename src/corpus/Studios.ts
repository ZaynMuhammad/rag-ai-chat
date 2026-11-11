import { parsePoint } from "./Catalog";

export interface StudioRow {
  readonly gameQid: string;
  readonly developerQid: string;
  readonly developerLabel: string | undefined;
  readonly placeQid: string;
  readonly placeLabel: string | undefined;
  readonly coordinates: string;
  readonly placeIsCountry: boolean;
}

export interface Studio {
  readonly gameQid: string;
  readonly developerQid: string;
  readonly developerLabel: string;
  readonly placeQid: string;
  readonly placeLabel: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface GenreRow {
  readonly gameQid: string;
  readonly genreQid: string;
  readonly label: string;
}

const toStudio = (row: StudioRow): Studio | undefined => {
  const point = parsePoint(row.coordinates);
  if (
    point === undefined ||
    row.placeIsCountry ||
    row.developerLabel === undefined ||
    row.placeLabel === undefined
  )
    return undefined;
  return {
    gameQid: row.gameQid,
    developerQid: row.developerQid,
    developerLabel: row.developerLabel,
    placeQid: row.placeQid,
    placeLabel: row.placeLabel,
    ...point,
  };
};

const byPlaceQid = (a: Studio, b: Studio) =>
  a.placeQid.localeCompare(b.placeQid);

export const studioLocations = (
  rows: ReadonlyArray<StudioRow>,
): ReadonlyArray<Studio> => {
  const located = new Map<string, Studio>();
  for (const studio of rows.map(toStudio)) {
    if (studio === undefined) continue;
    const key = `${studio.gameQid} ${studio.developerQid}`;
    const current = located.get(key);
    if (current === undefined || byPlaceQid(studio, current) < 0)
      located.set(key, studio);
  }
  return [...located.values()];
};

export const distinctGenres = (
  rows: ReadonlyArray<GenreRow>,
): ReadonlyArray<GenreRow> => [
  ...new Map(
    rows.map((row) => [`${row.gameQid} ${row.genreQid}`, row]),
  ).values(),
];

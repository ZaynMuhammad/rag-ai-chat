import { regionOf } from "./Region";
import type { GameOriginRow, OriginSource, PlaceRow } from "./Wikidata";

export interface Origin {
  readonly placeQid: string;
  readonly placeLabel: string;
  readonly iso2: string;
  readonly country: string;
  readonly region: string;
  readonly subRegion: string;
  readonly intermediateRegion: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly source: OriginSource;
}

export interface CatalogGame {
  readonly qid: string;
  readonly title: string;
  readonly origins: ReadonlyArray<Origin>;
}

export interface Catalog {
  readonly games: ReadonlyArray<CatalogGame>;
  readonly unplacedGameQids: ReadonlyArray<string>;
  readonly unresolvedPlaceQids: ReadonlyArray<string>;
}

type Place = Omit<Origin, "source">;

const wktPoint =
  /^Point\((-?\d+(?:\.\d+)?(?:e-?\d+)?) (-?\d+(?:\.\d+)?(?:e-?\d+)?)\)$/i;

export const parsePoint = (wkt: string) => {
  const match = wktPoint.exec(wkt.trim());
  if (match === null) return undefined;
  return { longitude: Number(match[1]), latitude: Number(match[2]) };
};

const firstSorted = (values: ReadonlyArray<string | undefined>) =>
  values.filter((value) => value !== undefined).sort()[0];

const groupBy = <A>(items: ReadonlyArray<A>, key: (item: A) => string) => {
  const groups = new Map<string, Array<A>>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
};

const resolvePlace = (
  qid: string,
  rows: ReadonlyArray<PlaceRow>,
): Place | undefined => {
  const iso2 = firstSorted(rows.map((row) => row.iso2));
  const coordinates = firstSorted(rows.map((row) => row.coordinates));
  const point = coordinates === undefined ? undefined : parsePoint(coordinates);
  const area = iso2 === undefined ? undefined : regionOf(iso2);
  if (area === undefined || point === undefined) return undefined;
  return {
    placeQid: qid,
    placeLabel: firstSorted(rows.map((row) => row.label)) ?? area.country,
    iso2: area.iso2,
    country: area.country,
    region: area.region,
    subRegion: area.subRegion,
    intermediateRegion: area.intermediateRegion,
    ...point,
  };
};

export const buildCatalog = (
  gameOrigins: ReadonlyArray<GameOriginRow>,
  placeRows: ReadonlyArray<PlaceRow>,
): Catalog => {
  const places = new Map<string, Place>();
  const unresolvedPlaceQids: Array<string> = [];
  for (const [qid, rows] of groupBy(placeRows, (row) => row.qid)) {
    const place = resolvePlace(qid, rows);
    if (place) places.set(qid, place);
    else unresolvedPlaceQids.push(qid);
  }

  const games: Array<CatalogGame> = [];
  const unplacedGameQids: Array<string> = [];
  for (const [qid, rows] of groupBy(gameOrigins, (row) => row.gameQid)) {
    const sourceByOrigin = new Map(
      rows.map((row) => [row.originQid, row.source]),
    );
    const origins = [...sourceByOrigin]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([originQid, source]) => {
        const place = places.get(originQid);
        return place ? [{ ...place, source }] : [];
      });
    const title = firstSorted(rows.map((row) => row.title));
    if (origins.length === 0 || title === undefined) unplacedGameQids.push(qid);
    else games.push({ qid, title, origins });
  }

  return {
    games: games.sort((a, b) => a.qid.localeCompare(b.qid)),
    unplacedGameQids: unplacedGameQids.sort(),
    unresolvedPlaceQids: unresolvedPlaceQids.sort(),
  };
};

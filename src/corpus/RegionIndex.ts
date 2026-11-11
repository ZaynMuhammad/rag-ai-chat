export interface PlacedGame {
  readonly qid: string;
  readonly title: string;
  readonly url: string | null;
  readonly passages: number;
  readonly placeLabel: string;
  readonly iso2: string;
  readonly country: string;
  readonly region: string;
  readonly subRegion: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface CountryGames {
  readonly iso2: string;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly games: ReadonlyArray<{
    readonly qid: string;
    readonly title: string;
    readonly url: string;
    readonly passages: number;
    readonly placeLabel: string;
    readonly latitude: number;
    readonly longitude: number;
  }>;
}

export interface SubRegionGames {
  readonly subRegion: string;
  readonly gameCount: number;
  readonly countries: ReadonlyArray<CountryGames>;
}

export interface RegionGames {
  readonly region: string;
  readonly gameCount: number;
  readonly subRegions: ReadonlyArray<SubRegionGames>;
}

const wikipediaUrl = (title: string) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;

const byCountThenName =
  <A>(count: (a: A) => number, name: (a: A) => string) =>
  (a: A, b: A) =>
    count(b) - count(a) || name(a).localeCompare(name(b));

const mostCommon = <A>(items: ReadonlyArray<A>, key: (item: A) => string) => {
  const counts = new Map<string, { item: A; count: number }>();
  for (const item of items) {
    const entry = counts.get(key(item));
    counts.set(key(item), { item, count: (entry?.count ?? 0) + 1 });
  }
  const [top] = [...counts.values()].sort(
    byCountThenName(
      (entry) => entry.count,
      (entry) => key(entry.item),
    ),
  );
  return top?.item;
};

const countryGames = (
  games: ReadonlyArray<PlacedGame>,
): ReadonlyArray<CountryGames> => {
  const anchor = mostCommon(
    games,
    (game) => `${game.latitude},${game.longitude}`,
  );
  if (anchor === undefined) return [];
  return [
    {
      iso2: anchor.iso2,
      country: anchor.country,
      latitude: anchor.latitude,
      longitude: anchor.longitude,
      games: [...games]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((game) => ({
          qid: game.qid,
          title: game.title,
          url: game.url ?? wikipediaUrl(game.title),
          passages: game.passages,
          placeLabel: game.placeLabel,
          latitude: game.latitude,
          longitude: game.longitude,
        })),
    },
  ];
};

const distinctGames = (games: ReadonlyArray<PlacedGame>) =>
  new Set(games.map((game) => game.qid)).size;

export const groupByRegion = (
  placed: ReadonlyArray<PlacedGame>,
): ReadonlyArray<RegionGames> =>
  [...Map.groupBy(placed, (game) => game.region)]
    .map(([region, inRegion]) => ({
      region,
      gameCount: distinctGames(inRegion),
      subRegions: [...Map.groupBy(inRegion, (game) => game.subRegion)]
        .map(([subRegion, inSubRegion]) => ({
          subRegion,
          gameCount: distinctGames(inSubRegion),
          countries: [...Map.groupBy(inSubRegion, (game) => game.iso2).values()]
            .flatMap(countryGames)
            .sort(
              byCountThenName(
                (country) => country.games.length,
                (country) => country.country,
              ),
            ),
        }))
        .sort(
          byCountThenName(
            (subRegion) => subRegion.gameCount,
            (subRegion) => subRegion.subRegion,
          ),
        ),
    }))
    .sort(
      byCountThenName(
        (region) => region.gameCount,
        (region) => region.region,
      ),
    );

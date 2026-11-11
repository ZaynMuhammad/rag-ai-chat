import type { SubRegionCount } from "@/server/games/GameCatalog";

const byRegion = (subRegions: ReadonlyArray<SubRegionCount>) =>
  [...Map.groupBy(subRegions, (row) => row.region)].map(([region, rows]) => ({
    region,
    games: rows.reduce((total, row) => total + row.games, 0),
    rows,
  }));

export function AreaOptions({
  subRegions,
}: {
  subRegions: ReadonlyArray<SubRegionCount>;
}) {
  return (
    <>
      <option value="">Every region</option>
      {byRegion(subRegions).map(({ region, games, rows }) => (
        <optgroup key={region} label={region}>
          <option value={region}>
            All of {region} ({games.toLocaleString("en")})
          </option>
          {rows.map((row) => (
            <option
              key={row.subRegion}
              value={`${row.region}|${row.subRegion}`}
            >
              {row.subRegion} ({row.games.toLocaleString("en")})
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

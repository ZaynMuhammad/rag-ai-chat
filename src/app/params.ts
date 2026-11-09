import { Option, Schema } from "effect";
import type { BrowseQuery } from "@/server/games/GameCatalog";
import { SortOrder } from "@/server/games/GameCatalog";
import { Year, type Scope } from "@/server/games/Scope";

export type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string) => {
  const value = params[key];
  const text = (Array.isArray(value) ? value[0] : value)?.trim();
  return text === undefined || text === "" ? undefined : text;
};

const decodeYear = Schema.decodeUnknownOption(
  Schema.NumberFromString.pipe(Schema.decodeTo(Year)),
);
const decodePage = Schema.decodeUnknownOption(
  Schema.NumberFromString.pipe(
    Schema.decodeTo(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
    ),
  ),
);
const decodeSort = Schema.decodeUnknownOption(SortOrder);

const areaSeparator = "|";

export const areaValue = (scope: Pick<Scope, "region" | "subRegion">) =>
  scope.region === undefined
    ? ""
    : scope.subRegion === undefined
      ? scope.region
      : `${scope.region}${areaSeparator}${scope.subRegion}`;

const optional = <K extends string, A>(key: K, value: A | undefined) =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, A>>;

export const scopeFromParams = (
  params: SearchParams,
): Omit<Scope, "gameQid"> => {
  const [region, subRegion] = (first(params, "area") ?? "").split(
    areaSeparator,
  );
  const from = Option.getOrUndefined(decodeYear(first(params, "from")));
  const to = Option.getOrUndefined(decodeYear(first(params, "to")));
  return {
    ...optional("region", region === "" ? undefined : region?.slice(0, 80)),
    ...optional("subRegion", subRegion?.slice(0, 80)),
    ...optional("from", from),
    ...optional("to", to),
  };
};

export const browseQueryFromParams = (params: SearchParams): BrowseQuery => ({
  ...scopeFromParams(params),
  ...optional("title", first(params, "title")?.slice(0, 100)),
  sort: Option.getOrElse(
    decodeSort(first(params, "sort")),
    () => "newest" as const,
  ),
  page: Option.getOrElse(decodePage(first(params, "page")), () => 1),
});

export const queryString = (query: Partial<BrowseQuery>) => {
  const params = new URLSearchParams();
  const area = areaValue(query);
  if (area !== "") params.set("area", area);
  if (query.from !== undefined) params.set("from", String(query.from));
  if (query.to !== undefined) params.set("to", String(query.to));
  if (query.title !== undefined) params.set("title", query.title);
  if (query.sort !== undefined && query.sort !== "newest")
    params.set("sort", query.sort);
  if (query.page !== undefined && query.page > 1)
    params.set("page", String(query.page));
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
};

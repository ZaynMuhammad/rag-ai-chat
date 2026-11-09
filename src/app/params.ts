import { Option, Schema } from "effect";
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

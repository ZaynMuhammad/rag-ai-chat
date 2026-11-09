import { Schema } from "effect";
import m49 from "./m49.json";

export class AreaRegion extends Schema.Class<AreaRegion>(
  "rag-ai-chat/corpus/AreaRegion",
)({
  iso2: Schema.String,
  country: Schema.String,
  region: Schema.String,
  subRegion: Schema.String,
  intermediateRegion: Schema.NullOr(Schema.String),
}) {}

const areasMissingFromM49: ReadonlyArray<typeof AreaRegion.Encoded> = [
  {
    iso2: "TW",
    country: "Taiwan",
    region: "Asia",
    subRegion: "Eastern Asia",
    intermediateRegion: null,
  },
  {
    iso2: "XK",
    country: "Kosovo",
    region: "Europe",
    subRegion: "Southern Europe",
    intermediateRegion: null,
  },
  {
    iso2: "SU",
    country: "Soviet Union",
    region: "Europe",
    subRegion: "Eastern Europe",
    intermediateRegion: null,
  },
  {
    iso2: "CS",
    country: "Czechoslovakia",
    region: "Europe",
    subRegion: "Eastern Europe",
    intermediateRegion: null,
  },
  {
    iso2: "DD",
    country: "East Germany",
    region: "Europe",
    subRegion: "Western Europe",
    intermediateRegion: null,
  },
  {
    iso2: "YU",
    country: "Yugoslavia",
    region: "Europe",
    subRegion: "Southern Europe",
    intermediateRegion: null,
  },
];

const areas = Schema.decodeUnknownSync(Schema.Array(AreaRegion))([
  ...m49,
  ...areasMissingFromM49,
]);
const areasByIso2 = new Map(areas.map((area) => [area.iso2, area]));

export const regionOf = (iso2: string) => areasByIso2.get(iso2.toUpperCase());

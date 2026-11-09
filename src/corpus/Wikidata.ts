import { Context, Effect, flow, Layer, Schedule, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

const endpoint = "https://query.wikidata.org/sparql";
const userAgent =
  "rag-ai-chat/0.1 (https://github.com/ZaynMuhammad/rag-ai-chat)";

const Binding = Schema.Struct({ value: Schema.String });
const OptionalBinding = Schema.optionalKey(Binding);

const sparqlResults = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.Struct({
    results: Schema.Struct({ bindings: Schema.Array(Schema.Struct(fields)) }),
  });

export const OriginSource = Schema.Literals([
  "country_of_origin",
  "developer_country",
]);
export type OriginSource = typeof OriginSource.Type;

const GameOriginResults = sparqlResults({
  game: Binding,
  title: Binding,
  origin: Binding,
  source: Schema.Struct({ value: OriginSource }),
});

const PlaceResults = sparqlResults({
  place: Binding,
  label: OptionalBinding,
  iso2: OptionalBinding,
  coordinates: OptionalBinding,
});

export interface GameOriginRow {
  readonly gameQid: string;
  readonly title: string;
  readonly originQid: string;
  readonly source: OriginSource;
}

export interface PlaceRow {
  readonly qid: string;
  readonly label: string | undefined;
  readonly iso2: string | undefined;
  readonly coordinates: string | undefined;
}

export const videoGameOriginsQuery = `
SELECT ?game ?title ?origin ?source WHERE {
  ?game wdt:P31 wd:Q7889 .
  ?article schema:about ?game ;
           schema:isPartOf <https://en.wikipedia.org/> ;
           schema:name ?title .
  {
    ?game wdt:P495 ?origin .
    BIND("country_of_origin" AS ?source)
  } UNION {
    FILTER NOT EXISTS { ?game wdt:P495 [] }
    ?game wdt:P178/wdt:P17 ?origin .
    BIND("developer_country" AS ?source)
  }
  FILTER(STRSTARTS(STR(?origin), STR(wd:)))
}`;

export const placesQuery = (qids: ReadonlyArray<string>) => `
SELECT ?place ?label ?iso2 ?coordinates WHERE {
  VALUES ?place { ${qids.map((qid) => `wd:${qid}`).join(" ")} }
  OPTIONAL { ?place rdfs:label ?label FILTER(LANG(?label) = "en") }
  OPTIONAL { ?place wdt:P297 ?ownIso2 }
  OPTIONAL { ?place wdt:P17/wdt:P297 ?sovereignIso2 }
  OPTIONAL { ?place wdt:P773 ?formerCountryCode }
  OPTIONAL { ?place wdt:P1366/wdt:P297 ?successorIso2 }
  BIND(COALESCE(?ownIso2, ?sovereignIso2, SUBSTR(?formerCountryCode, 1, 2), ?successorIso2) AS ?iso2)
  OPTIONAL { ?place wdt:P625 ?coordinates }
}`;

export const entityQid = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

export class WikidataError extends Schema.TaggedError<WikidataError>()(
  "WikidataError",
  {
    cause: Schema.Defect(),
  },
) {}

export class Wikidata extends Context.Service<
  Wikidata,
  {
    readonly videoGameOrigins: Effect.Effect<
      ReadonlyArray<GameOriginRow>,
      WikidataError
    >;
    places(
      qids: ReadonlyArray<string>,
    ): Effect.Effect<ReadonlyArray<PlaceRow>, WikidataError>;
  }
>()("rag-ai-chat/corpus/Wikidata") {
  static readonly layer = Layer.effect(
    Wikidata,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(
          flow(
            // eslint-disable-next-line no-restricted-syntax -- our own outgoing User-Agent, required by Wikimedia policy
            HttpClientRequest.setHeader("User-Agent", userAgent),
            HttpClientRequest.setHeader(
              "Accept",
              "application/sparql-results+json",
            ),
          ),
        ),
        HttpClient.filterStatusOk,
        HttpClient.retryTransient({
          schedule: Schedule.exponential("2 seconds"),
          times: 4,
        }),
      );

      const select = <S extends Schema.Top>(query: string, schema: S) =>
        HttpClientRequest.post(endpoint).pipe(
          HttpClientRequest.bodyUrlParams({ query }),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
          Effect.mapError((cause) => new WikidataError({ cause })),
        );

      const videoGameOrigins = select(
        videoGameOriginsQuery,
        GameOriginResults,
      ).pipe(
        Effect.map(({ results }) =>
          results.bindings.map((row) => ({
            gameQid: entityQid(row.game.value),
            title: row.title.value,
            originQid: entityQid(row.origin.value),
            source: row.source.value,
          })),
        ),
        Effect.withSpan("Wikidata.videoGameOrigins"),
      );

      const places = Effect.fn("Wikidata.places")(function* (
        qids: ReadonlyArray<string>,
      ) {
        const { results } = yield* select(placesQuery(qids), PlaceResults);
        return results.bindings.map((row) => ({
          qid: entityQid(row.place.value),
          label: row.label?.value,
          iso2: row.iso2?.value,
          coordinates: row.coordinates?.value,
        }));
      });

      return Wikidata.of({ videoGameOrigins, places });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}

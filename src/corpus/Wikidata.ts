import {
  Array as Arr,
  Context,
  Effect,
  flow,
  Layer,
  Schedule,
  Schema,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import type { ReleaseDateRow } from "./ReleaseDate";
import type { GenreRow, StudioRow } from "./Studios";

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

const ReleaseDateResults = sparqlResults({
  game: Binding,
  date: Binding,
  precision: Binding,
});

const StudioResults = sparqlResults({
  game: Binding,
  developer: Binding,
  developerLabel: OptionalBinding,
  place: Binding,
  placeLabel: OptionalBinding,
  coordinates: Binding,
  placeIsCountry: Binding,
});

const GenreResults = sparqlResults({
  game: Binding,
  genre: Binding,
  label: Binding,
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

export const releaseDatesQuery = (qids: ReadonlyArray<string>) => `
SELECT ?game ?date ?precision WHERE {
  VALUES ?game { ${qids.map((qid) => `wd:${qid}`).join(" ")} }
  ?game p:P577/psv:P577 [ wikibase:timeValue ?date ; wikibase:timePrecision ?precision ] .
}`;

export const studiosQuery = (qids: ReadonlyArray<string>) => `
SELECT ?game ?developer ?developerLabel ?place ?placeLabel ?coordinates ?placeIsCountry WHERE {
  VALUES ?game { ${qids.map((qid) => `wd:${qid}`).join(" ")} }
  ?game wdt:P178 ?developer .
  ?developer wdt:P159 ?place .
  ?place wdt:P625 ?coordinates .
  OPTIONAL { ?developer rdfs:label ?developerLabel FILTER(LANG(?developerLabel) = "en") }
  OPTIONAL { ?place rdfs:label ?placeLabel FILTER(LANG(?placeLabel) = "en") }
  BIND(EXISTS { ?place wdt:P297 [] } AS ?placeIsCountry)
}`;

export const genresQuery = (qids: ReadonlyArray<string>) => `
SELECT ?game ?genre ?label WHERE {
  VALUES ?game { ${qids.map((qid) => `wd:${qid}`).join(" ")} }
  ?game wdt:P136 ?genre .
  ?genre rdfs:label ?label FILTER(LANG(?label) = "en")
}`;

const gamesPerBatchQuery = 2000;

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
    releaseDates(
      gameQids: ReadonlyArray<string>,
    ): Effect.Effect<ReadonlyArray<ReleaseDateRow>, WikidataError>;
    studios(
      gameQids: ReadonlyArray<string>,
    ): Effect.Effect<ReadonlyArray<StudioRow>, WikidataError>;
    genres(
      gameQids: ReadonlyArray<string>,
    ): Effect.Effect<ReadonlyArray<GenreRow>, WikidataError>;
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

      const inBatches = <Row>(
        gameQids: ReadonlyArray<string>,
        batch: (
          qids: ReadonlyArray<string>,
        ) => Effect.Effect<ReadonlyArray<Row>, WikidataError>,
      ) =>
        Effect.forEach(Arr.chunksOf(gameQids, gamesPerBatchQuery), batch).pipe(
          Effect.map((batches) => batches.flat()),
        );

      const releaseDatesInBatch = (qids: ReadonlyArray<string>) =>
        select(releaseDatesQuery(qids), ReleaseDateResults).pipe(
          Effect.map(({ results }) =>
            results.bindings.map((row) => ({
              gameQid: entityQid(row.game.value),
              date: row.date.value,
              precision: Number(row.precision.value),
            })),
          ),
        );

      const studiosInBatch = (qids: ReadonlyArray<string>) =>
        select(studiosQuery(qids), StudioResults).pipe(
          Effect.map(({ results }) =>
            results.bindings.map((row) => ({
              gameQid: entityQid(row.game.value),
              developerQid: entityQid(row.developer.value),
              developerLabel: row.developerLabel?.value,
              placeQid: entityQid(row.place.value),
              placeLabel: row.placeLabel?.value,
              coordinates: row.coordinates.value,
              placeIsCountry: row.placeIsCountry.value === "true",
            })),
          ),
        );

      const genresInBatch = (qids: ReadonlyArray<string>) =>
        select(genresQuery(qids), GenreResults).pipe(
          Effect.map(({ results }) =>
            results.bindings.map((row) => ({
              gameQid: entityQid(row.game.value),
              genreQid: entityQid(row.genre.value),
              label: row.label.value,
            })),
          ),
        );

      const releaseDates = Effect.fn("Wikidata.releaseDates")(function* (
        gameQids: ReadonlyArray<string>,
      ) {
        return yield* inBatches(gameQids, releaseDatesInBatch);
      });

      const studios = Effect.fn("Wikidata.studios")(function* (
        gameQids: ReadonlyArray<string>,
      ) {
        return yield* inBatches(gameQids, studiosInBatch);
      });

      const genres = Effect.fn("Wikidata.genres")(function* (
        gameQids: ReadonlyArray<string>,
      ) {
        return yield* inBatches(gameQids, genresInBatch);
      });

      return Wikidata.of({
        videoGameOrigins,
        places,
        releaseDates,
        studios,
        genres,
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}

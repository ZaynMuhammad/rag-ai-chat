import { createHash, timingSafeEqual } from "node:crypto";
import { Config, Effect, Option, Redacted } from "effect";
import { PrometheusMetrics } from "effect/observability";

const digest = (text: string) => createHash("sha256").update(text).digest();

const sameSecret = (given: string | null, expected: string) =>
  given !== null && timingSafeEqual(digest(given), digest(expected));

export const scrapeMetrics = Effect.fn("MetricsScrape.scrape")(function* (
  token: string | null,
) {
  const required = yield* Config.option(Config.Redacted("METRICS_TOKEN"));
  if (
    Option.isSome(required) &&
    !sameSecret(token, Redacted.value(required.value))
  ) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }
  return new Response(yield* PrometheusMetrics.format(), {
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}, Effect.orDie);

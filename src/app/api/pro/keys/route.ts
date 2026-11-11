import { Effect, Schema } from "effect";
import { runAtRequestTime } from "@/app/run";
import { ProCredentials } from "@/server/pro/ProCredentials";
import { PublishedKeys } from "@/server/pro/ProProtocol";

const encodeKeys = Schema.encodeSync(PublishedKeys);

export async function GET() {
  const published = await runAtRequestTime(
    Effect.flatMap(ProCredentials, (credentials) => credentials.keys),
  );
  return Response.json(encodeKeys(published), {
    headers: { "cache-control": "public, max-age=300" },
  });
}

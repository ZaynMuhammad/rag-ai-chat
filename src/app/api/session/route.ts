import { Effect, Exit, Schema } from "effect";
import { AnonymousSessions } from "@/server/gateway/AnonymousSessions";
import { refusal } from "@/server/gateway/responses";
import { ProCredentials } from "@/server/pro/ProCredentials";
import { SessionRequest } from "@/server/pro/ProProtocol";
import { runtime } from "@/server/runtime";

const decodeSessionRequest = Schema.decodeUnknownExit(
  Schema.fromJsonString(SessionRequest),
);

export async function POST(request: Request) {
  const text = await request.text();
  const decoded = decodeSessionRequest(text === "" ? "{}" : text);
  if (Exit.isFailure(decoded)) {
    return Response.json(
      { message: "Invalid session request" },
      { status: 400 },
    );
  }
  const { credential } = decoded.value;

  return runtime.runPromise(
    Effect.gen(function* () {
      if (credential === undefined) {
        return yield* Effect.flatMap(AnonymousSessions, (s) => s.issue);
      }
      return yield* Effect.flatMap(ProCredentials, (c) => c.redeem(credential));
    }).pipe(
      Effect.match({
        onFailure: refusal,
        onSuccess: (session) =>
          Response.json(session, { headers: { "cache-control": "no-store" } }),
      }),
    ),
  );
}

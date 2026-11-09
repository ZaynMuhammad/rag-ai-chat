import { Effect } from "effect";
import { AnonymousSessions } from "@/server/gateway/AnonymousSessions";
import { refusal } from "@/server/gateway/responses";
import { runtime } from "@/server/runtime";

export async function POST() {
  return runtime.runPromise(
    Effect.flatMap(AnonymousSessions, (sessions) => sessions.issue).pipe(
      Effect.match({
        onFailure: refusal,
        onSuccess: (session) =>
          Response.json(session, { headers: { "cache-control": "no-store" } }),
      }),
    ),
  );
}

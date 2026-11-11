import { Effect, Exit, Schema } from "effect";
import { ChatRequest } from "@/server/chat/ChatProtocol";
import { GroundedChat } from "@/server/chat/GroundedChat";
import { toSseBody } from "@/server/chat/sse";
import { AnonymousSessions } from "@/server/gateway/AnonymousSessions";
import { refusal } from "@/server/gateway/responses";
import { runtime } from "@/server/runtime";

const decodeChatRequest = Schema.decodeUnknownExit(ChatRequest);

const bearerToken = (request: Request) =>
  request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => undefined);
  const decoded = decodeChatRequest(body);
  if (Exit.isFailure(decoded)) {
    return Response.json({ message: "Invalid chat request" }, { status: 400 });
  }

  return runtime.runPromise(
    Effect.gen(function* () {
      const sessions = yield* AnonymousSessions;
      const chat = yield* GroundedChat;
      const answer = yield* chat.stream(decoded.value);
      yield* sessions.admitChat(bearerToken(request));
      return new Response(toSseBody(answer), {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        },
      });
    }).pipe(
      Effect.catchTag("UnknownModel", () =>
        Effect.succeed(
          Response.json({ message: "Unknown model" }, { status: 400 }),
        ),
      ),
      Effect.catch((error) => Effect.succeed(refusal(error))),
    ),
  );
}

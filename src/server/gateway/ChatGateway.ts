import { Effect, Exit, Schema } from "effect";
import { ChatRequest } from "@/server/chat/ChatProtocol";
import { GroundedChat } from "@/server/chat/GroundedChat";
import { toSseBody } from "@/server/chat/sse";
import { countChat } from "@/server/metrics/GatewayMetrics";
import { AnonymousSessions } from "./AnonymousSessions";
import { refusal } from "./responses";

const decodeChatRequest = Schema.decodeUnknownExit(ChatRequest);

export const serveChat = Effect.fn("ChatGateway.serveChat")(function* (
  token: string | null,
  body: unknown,
) {
  const decoded = decodeChatRequest(body);
  if (Exit.isFailure(decoded)) {
    yield* countChat("invalid");
    return Response.json({ message: "Invalid chat request" }, { status: 400 });
  }
  const sessions = yield* AnonymousSessions;
  const chat = yield* GroundedChat;
  return yield* sessions.admitChat(token).pipe(
    Effect.andThen(() => toSseBody(chat.stream(decoded.value))),
    Effect.map(
      (sse) =>
        new Response(sse, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
          },
        }),
    ),
    Effect.catch((error) =>
      Effect.as(
        countChat(error._tag === "RateLimited" ? "rate_limited" : "invalid"),
        refusal(error),
      ),
    ),
  );
});

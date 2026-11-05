import { Effect, Exit, Schema } from "effect";
import { Chat } from "@/gateway/Chat";
import { ChatRequest } from "@/gateway/ChatProtocol";
import { toSseBody } from "@/gateway/sse";
import { runtime } from "@/server/runtime";

const decodeChatRequest = Schema.decodeUnknownExit(ChatRequest);

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => undefined);
  const decoded = decodeChatRequest(body);
  if (Exit.isFailure(decoded)) {
    return Response.json({ message: "Invalid chat request" }, { status: 400 });
  }

  const events = await runtime.runPromise(
    Effect.map(Chat, (chat) => chat.stream(decoded.value)),
  );

  return new Response(toSseBody(events), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

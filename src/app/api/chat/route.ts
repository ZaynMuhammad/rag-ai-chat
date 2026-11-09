import { Effect, Exit, Schema } from "effect";
import { ChatRequest } from "@/server/chat/ChatProtocol";
import { GroundedChat } from "@/server/chat/GroundedChat";
import { toSseBody } from "@/server/chat/sse";
import { runtime } from "@/server/runtime";

const decodeChatRequest = Schema.decodeUnknownExit(ChatRequest);

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => undefined);
  const decoded = decodeChatRequest(body);
  if (Exit.isFailure(decoded)) {
    return Response.json({ message: "Invalid chat request" }, { status: 400 });
  }

  const events = await runtime.runPromise(
    Effect.map(GroundedChat, (chat) => chat.stream(decoded.value)),
  );

  return new Response(toSseBody(events), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

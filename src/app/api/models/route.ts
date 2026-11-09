import { Effect } from "effect";
import { runAtRequestTime } from "@/app/run";
import type { ChatModelList } from "@/server/chat/ChatProtocol";
import { GroundedChat } from "@/server/chat/GroundedChat";

export async function GET() {
  return runAtRequestTime(
    Effect.map(GroundedChat, ({ models }) => {
      const list: ChatModelList = {
        models,
        default: models[0]?.id ?? "mock-extractive",
      };
      return Response.json(list, {
        headers: { "cache-control": "no-store" },
      });
    }),
  );
}

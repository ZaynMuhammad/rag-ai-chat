import { Array as Arr, Effect } from "effect";
import { runAtRequestTime } from "@/app/run";
import type { ChatModelList } from "@/server/chat/ChatProtocol";
import { GroundedChat } from "@/server/chat/GroundedChat";

export async function GET() {
  return runAtRequestTime(
    Effect.map(GroundedChat, ({ models }) => {
      const list: ChatModelList = {
        models,
        default: Arr.headNonEmpty(models).id,
      };
      return Response.json(list, {
        headers: { "cache-control": "no-store" },
      });
    }),
  );
}

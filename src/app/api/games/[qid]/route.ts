import { Effect } from "effect";
import type { NextRequest } from "next/server";
import { GameCatalog } from "@/server/games/GameCatalog";
import { runtime } from "@/server/runtime";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/games/[qid]">,
) {
  const { qid } = await context.params;
  return runtime.runPromise(
    Effect.flatMap(GameCatalog, (catalog) => catalog.game(qid)).pipe(
      Effect.match({
        onFailure: () =>
          Response.json({ message: "Game not found" }, { status: 404 }),
        onSuccess: (game) => Response.json(game),
      }),
    ),
  );
}

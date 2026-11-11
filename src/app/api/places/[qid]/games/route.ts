import { Effect, Exit, Schema } from "effect";
import type { NextRequest } from "next/server";
import { GameCatalog } from "@/server/games/GameCatalog";
import { PlaceGamesQuery } from "@/server/games/GameProtocol";
import { runtime } from "@/server/runtime";

const decodeQuery = Schema.decodeUnknownExit(PlaceGamesQuery);

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/places/[qid]/games">,
) {
  const decoded = decodeQuery({
    placeQid: (await context.params).qid,
    kind: request.nextUrl.searchParams.get("kind"),
    page: Number(request.nextUrl.searchParams.get("page") ?? "1"),
  });
  if (Exit.isFailure(decoded)) {
    return Response.json({ message: "Invalid place" }, { status: 400 });
  }
  const page = await runtime.runPromise(
    Effect.flatMap(GameCatalog, (catalog) => catalog.placeGames(decoded.value)),
  );
  return Response.json(page);
}

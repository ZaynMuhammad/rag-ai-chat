import { Schema } from "effect";
import {
  type GameDetail,
  type Pin,
  GameDetail as GameDetailSchema,
  type PlaceGamesPage,
  PlaceGamesPage as PlaceGamesPageSchema,
} from "@/server/games/GameProtocol";

const decodePlaceGames = Schema.decodeUnknownSync(PlaceGamesPageSchema);
const decodeGame = Schema.decodeUnknownSync(GameDetailSchema);

const fetchJson = async <A>(url: string, decode: (json: unknown) => A) => {
  try {
    const response = await fetch(url);
    return response.ok ? decode(await response.json()) : null;
  } catch {
    return null;
  }
};

export const fetchPlaceGames = (
  pin: Pin,
  page: number,
): Promise<PlaceGamesPage | null> =>
  fetchJson(
    `/api/places/${encodeURIComponent(pin.placeQid)}/games?kind=${pin.kind}&page=${page}`,
    decodePlaceGames,
  );

export const fetchGame = (qid: string): Promise<GameDetail | null> =>
  fetchJson(`/api/games/${encodeURIComponent(qid)}`, decodeGame);

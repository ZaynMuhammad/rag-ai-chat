"use client";

import { useState } from "react";
import { fetchGame, fetchPlaceGames } from "@/lib/atlas";
import type { Pin } from "@/server/games/GameProtocol";
import { GameDialog, type OpenGame } from "./GameDialog";
import { Globe } from "./Globe";
import { type GameRef, PlacePanel, type PlaceSelection } from "./PlacePanel";

export function Atlas({ pins }: { pins: ReadonlyArray<Pin> }) {
  const [place, setPlace] = useState<PlaceSelection | null>(null);
  const [openGame, setOpenGame] = useState<OpenGame | null>(null);

  const selectPin = (pin: Pin) => {
    setPlace({ pin, pages: [fetchPlaceGames(pin.placeQid, 1)] });
  };

  const showMorePlaceGames = (page: number) => {
    if (place === null) return;
    setPlace({
      ...place,
      pages: [...place.pages, fetchPlaceGames(place.pin.placeQid, page)],
    });
  };

  const openArticle = (game: GameRef) => {
    setOpenGame({ game, detail: fetchGame(game.qid) });
  };

  return (
    <div className="relative size-full">
      <Globe pins={pins} selected={place?.pin ?? null} onSelect={selectPin} />
      {place !== null && (
        <PlacePanel
          key={place.pin.placeQid}
          selection={place}
          onClose={() => {
            setPlace(null);
          }}
          onOpen={openArticle}
          onMore={showMorePlaceGames}
        />
      )}
      <GameDialog
        open={openGame}
        onClose={() => {
          setOpenGame(null);
        }}
      />
    </div>
  );
}

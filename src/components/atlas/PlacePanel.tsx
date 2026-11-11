"use client";

import { XIcon } from "lucide-react";
import { Suspense, use } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatGame } from "@/lib/chats";
import type {
  Pin,
  PlaceGame,
  PlaceGamesPage,
} from "@/server/games/GameProtocol";

export interface PlaceSelection {
  readonly pin: Pin;
  readonly pages: ReadonlyArray<Promise<PlaceGamesPage | null>>;
}

const shownGenres = 2;

function GameRow({
  game,
  onOpen,
}: {
  game: PlaceGame;
  onOpen: (game: ChatGame) => void;
}) {
  const year = game.released?.slice(0, 4) ?? null;
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          onOpen({ qid: game.qid, title: game.title });
        }}
        className="w-full rounded-lg px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="font-medium break-words">{game.title}</span>
          {year !== null && (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {year}
            </span>
          )}
        </span>
        {game.genres.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {game.genres.slice(0, shownGenres).map((genre) => (
              <Badge key={genre} variant="secondary" className="font-normal">
                {genre}
              </Badge>
            ))}
            {game.genres.length > shownGenres && (
              <span className="text-xs text-muted-foreground">
                +{game.genres.length - shownGenres}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

function Page({
  promise,
  isLast,
  onOpen,
  onMore,
}: {
  promise: Promise<PlaceGamesPage | null>;
  isLast: boolean;
  onOpen: (game: ChatGame) => void;
  onMore: (page: number) => void;
}) {
  const page = use(promise);
  if (page === null)
    return (
      <p className="px-3 py-2 text-sm text-destructive">
        Couldn&apos;t load these games. Try the pin again.
      </p>
    );
  return (
    <>
      <ul>
        {page.games.map((game) => (
          <GameRow key={game.qid} game={game} onOpen={onOpen} />
        ))}
      </ul>
      {isLast && page.page < page.pageCount && (
        <Button
          variant="ghost"
          size="sm"
          className="mx-3 my-2"
          onClick={() => {
            onMore(page.page + 1);
          }}
        >
          Show more
        </Button>
      )}
    </>
  );
}

function Loading() {
  return (
    <div className="space-y-2 px-3 py-2">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  );
}

export function PlacePanel({
  selection,
  onClose,
  onOpen,
  onMore,
}: {
  selection: PlaceSelection;
  onClose: () => void;
  onOpen: (game: ChatGame) => void;
  onMore: (page: number) => void;
}) {
  const { pin, pages } = selection;
  return (
    <section
      aria-label={`Games from ${pin.label}`}
      className="mx-3 flex h-1/2 shrink-0 flex-col rounded-xl border bg-popover text-popover-foreground shadow-lg md:my-3 md:ml-0 md:h-auto md:w-88"
    >
      <header className="flex items-start justify-between gap-2 border-b p-3">
        <div>
          <h2 className="font-semibold">{pin.label}</h2>
          <p className="text-xs text-muted-foreground">
            {pin.games.toLocaleString("en")}{" "}
            {pin.games === 1 ? "game" : "games"}
            {pin.kind === "studio"
              ? " from studios here"
              : " whose studio city isn't on Wikidata"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1">
          {pages.map((promise, index) => (
            <Suspense key={index} fallback={<Loading />}>
              <Page
                promise={promise}
                isLast={index === pages.length - 1}
                onOpen={onOpen}
                onMore={onMore}
              />
            </Suspense>
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}

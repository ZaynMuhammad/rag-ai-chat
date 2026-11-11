"use client";

import { Suspense, use } from "react";
import { ChatPanel, type CiteHandler } from "@/components/ChatPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { GameDetail } from "@/server/games/GameProtocol";
import { ArticleMeta, ArticleText, revealPassage } from "./Article";
import type { GameRef } from "./PlacePanel";

export interface OpenGame {
  readonly game: GameRef;
  readonly detail: Promise<GameDetail | null>;
}

const scrollToPassage =
  (gameQid: string): CiteHandler =>
  (passage) => {
    const section =
      passage.gameQid === gameQid ? document.getElementById(passage.id) : null;
    if (section === null) return false;
    revealPassage(section);
    return true;
  };

function ArticleBody({ detail }: { detail: Promise<GameDetail | null> }) {
  const game = use(detail);
  if (game === null)
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load this article. Close and try again.
      </p>
    );
  return (
    <>
      <ArticleMeta game={game} />
      <div className="mt-6">
        <ArticleText game={game} />
      </div>
    </>
  );
}

function ArticleLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  );
}

export function GameDialog({
  open,
  onClose,
}: {
  open: OpenGame | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      {open !== null && (
        <DialogContent className="flex h-[min(52rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle className="text-xl font-semibold">
              {open.game.title}
            </DialogTitle>
            <DialogDescription className="sr-only">
              The Wikipedia article for {open.game.title}, with a chat that
              answers from it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_26rem] lg:grid-rows-1">
            <ScrollArea className="min-h-0">
              <div className="px-5 py-4">
                <Suspense fallback={<ArticleLoading />}>
                  <ArticleBody detail={open.detail} />
                </Suspense>
              </div>
            </ScrollArea>
            <div className="flex min-h-0 flex-col border-t bg-muted/30 lg:border-t-0 lg:border-l">
              <ChatPanel
                key={open.game.qid}
                scope={{ gameQid: open.game.qid }}
                placeholder={`Ask about ${open.game.title}`}
                suggestions={[
                  `Who developed ${open.game.title}?`,
                  `How was ${open.game.title} received?`,
                ]}
                onCite={scrollToPassage(open.game.qid)}
              />
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

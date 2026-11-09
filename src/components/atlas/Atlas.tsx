"use client";

import { useState } from "react";
import { ChatPanel, type CiteHandler } from "@/components/ChatPanel";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { fetchGame, fetchPlaceGames } from "@/lib/atlas";
import {
  type ChatGame,
  findChat,
  saveChat,
  type StoredChat,
  type UiMessage,
} from "@/lib/chats";
import type { Pin } from "@/server/games/GameProtocol";
import { ChatSidebar } from "./ChatSidebar";
import { GameDialog, type OpenGame } from "./GameDialog";
import { Globe } from "./Globe";
import { PlacePanel, type PlaceSelection } from "./PlacePanel";

const titleLength = 60;

const chatTitle = (messages: ReadonlyArray<UiMessage>) => {
  const question = messages.find((message) => message.role === "user");
  const text = question?.content.trim() ?? "New chat";
  return text.length > titleLength
    ? `${text.slice(0, titleLength - 1)}…`
    : text;
};

export function Atlas({ pins }: { pins: ReadonlyArray<Pin> }) {
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
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

  const openGameChat = (
    game: ChatGame,
    gameChatId: string,
    focusPassageId?: string,
  ) => {
    setOpenGame({
      game,
      chatId: gameChatId,
      detail: fetchGame(game.qid),
      ...(focusPassageId === undefined ? {} : { focusPassageId }),
    });
  };

  const openStoredChat = (chat: StoredChat) => {
    if (chat.game === null) setChatId(chat.id);
    else openGameChat(chat.game, chat.id);
  };

  const startNewChat = () => {
    setChatId(crypto.randomUUID());
    setPlace(null);
  };

  const openCitedArticle: CiteHandler = (passage) => {
    openGameChat(
      { qid: passage.gameQid, title: passage.title },
      crypto.randomUUID(),
      passage.id,
    );
    return true;
  };

  return (
    <SidebarProvider className="h-dvh">
      <ChatSidebar
        activeChatId={openGame?.chatId ?? chatId}
        onNewChat={startNewChat}
        onOpenChat={openStoredChat}
      />
      <SidebarInset className="h-dvh overflow-hidden">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <SidebarTrigger />
          <h1 className="text-sm font-medium">
            Video games on Wikipedia, by where they were made
          </h1>
          <p className="ml-auto hidden text-xs text-muted-foreground md:block">
            Drag to spin · scroll to zoom · click a pin
          </p>
        </header>
        <ChatPanel
          key={chatId}
          scope={{}}
          placeholder="Ask about any game on the globe"
          initialMessages={findChat(chatId)?.messages ?? []}
          onSave={(messages) => {
            saveChat({
              id: chatId,
              title: chatTitle(messages),
              game: null,
              messages,
              updatedAt: Date.now(),
            });
          }}
          onCite={openCitedArticle}
          suggestions={[
            "Which country was Tetris created in?",
            "Who designed the first Metal Gear game?",
          ]}
          emptyState={
            <>
              <Globe
                pins={pins}
                selected={place?.pin ?? null}
                onSelect={selectPin}
              />
              {place !== null && (
                <PlacePanel
                  key={place.pin.placeQid}
                  selection={place}
                  onClose={() => {
                    setPlace(null);
                  }}
                  onOpen={(game) => {
                    openGameChat(game, crypto.randomUUID());
                  }}
                  onMore={showMorePlaceGames}
                />
              )}
            </>
          }
        />
      </SidebarInset>
      <GameDialog
        open={openGame}
        onClose={() => {
          setOpenGame(null);
        }}
      />
    </SidebarProvider>
  );
}

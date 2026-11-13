"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { ChatPanel, type CiteHandler } from "@/components/ChatPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { fetchGame, fetchPlaceGames } from "@/lib/atlas";
import {
  type ChatGame,
  deleteChat,
  findChat,
  saveChat,
  type StoredChat,
  type UiMessage,
} from "@/lib/chats";
import type { Pin } from "@/server/games/GameProtocol";
import {
  type GameView,
  gamePath,
  leaveView,
  pushView,
  replaceView,
  viewInHistory,
} from "./atlasHistory";
import { ChatSidebar } from "./ChatSidebar";
import { GameDialog, type OpenGame } from "./GameDialog";
import { Globe, pinKey } from "./Globe";
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

  const placeKey = place === null ? null : pinKey(place.pin);

  const showPlace = (pin: Pin | undefined) => {
    setPlace(
      pin === undefined ? null : { pin, pages: [fetchPlaceGames(pin, 1)] },
    );
  };

  const showGame = (view: GameView | null) => {
    setOpenGame(
      view === null ? null : { ...view, detail: fetchGame(view.game.qid) },
    );
  };

  const restoreView = useEffectEvent((state: unknown) => {
    const view = viewInHistory(state);
    if (view.place !== placeKey)
      showPlace(pins.find((pin) => pinKey(pin) === view.place));
    if (view.game?.chatId !== openGame?.chatId) showGame(view.game);
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- history.state is only readable after hydration
    restoreView(window.history.state);
    const onPopState = (event: PopStateEvent) => {
      restoreView(event.state);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const selectPin = (pin: Pin) => {
    const view = { place: pinKey(pin), game: null };
    if (place === null) pushView(view);
    else replaceView(view);
    showPlace(pin);
  };

  const showMorePlaceGames = (page: number) => {
    if (place === null) return;
    setPlace({
      ...place,
      pages: [...place.pages, fetchPlaceGames(place.pin, page)],
    });
  };

  const openGameChat = (
    game: ChatGame,
    gameChatId: string,
    focusPassageId?: string,
  ) => {
    const view: GameView = {
      game,
      chatId: gameChatId,
      ...(focusPassageId === undefined ? {} : { focusPassageId }),
    };
    pushView(
      { place: placeKey, game: view },
      gamePath(game.qid, focusPassageId),
    );
    showGame(view);
  };

  const openStoredChat = (chat: StoredChat) => {
    if (chat.game === null) setChatId(chat.id);
    else openGameChat(chat.game, chat.id);
  };

  const startNewChat = () => {
    setChatId(crypto.randomUUID());
    if (place !== null) leaveView();
  };

  const deleteStoredChat = (chat: StoredChat) => {
    deleteChat(chat.id);
    if (chat.id === chatId) setChatId(crypto.randomUUID());
    if (chat.id === openGame?.chatId) leaveView();
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
        onDeleteChat={deleteStoredChat}
      />
      <SidebarInset className="h-dvh overflow-hidden">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <SidebarTrigger />
          <h1 className="min-w-0 truncate text-sm font-medium">
            Video games on Wikipedia, by where they were made
          </h1>
          <p className="ml-auto hidden shrink-0 text-xs text-muted-foreground md:block">
            Drag to spin · scroll to zoom · click a pin
          </p>
          <ThemeToggle />
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
            <div className="flex size-full flex-col md:flex-row">
              <div className="min-h-0 min-w-0 flex-1">
                <Globe
                  pins={pins}
                  selected={place?.pin ?? null}
                  onSelect={selectPin}
                />
              </div>
              {place !== null && (
                <PlacePanel
                  key={pinKey(place.pin)}
                  selection={place}
                  onClose={leaveView}
                  onOpen={(game) => {
                    openGameChat(game, crypto.randomUUID());
                  }}
                  onMore={showMorePlaceGames}
                />
              )}
            </div>
          }
        />
      </SidebarInset>
      <GameDialog open={openGame} onClose={leaveView} />
    </SidebarProvider>
  );
}

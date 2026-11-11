"use client";

import { ChatPanel, type CiteHandler } from "@/components/ChatPanel";
import { type ChatGame, findChat, saveChat } from "@/lib/chats";

export function GameChat({
  game,
  chatId,
  onCite,
}: {
  game: ChatGame;
  chatId: string;
  onCite?: CiteHandler;
}) {
  return (
    <ChatPanel
      key={chatId}
      scope={{ gameQid: game.qid }}
      placeholder={`Ask about ${game.title}`}
      initialMessages={findChat(chatId)?.messages ?? []}
      onSave={(messages) => {
        saveChat({
          id: chatId,
          title: game.title,
          game,
          messages,
          updatedAt: Date.now(),
        });
      }}
      {...(onCite === undefined ? {} : { onCite })}
      suggestions={[
        `Who developed ${game.title}?`,
        `How was ${game.title} received?`,
      ]}
      emptyState={
        <p className="p-4 text-sm text-muted-foreground">
          Ask about {game.title}. Answers come only from its Wikipedia article,
          with numbered citations.
        </p>
      }
    />
  );
}

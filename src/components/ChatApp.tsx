"use client";

import { useRef, useState } from "react";
import type { Article } from "@/rag/Article";
import type { ChatMessage } from "@/gateway/ChatProtocol";
import { readSse } from "@/gateway/sse";
import { ArticlePicker } from "./ArticlePicker";
import { ChatPanel, type UiMessage } from "./ChatPanel";

const toHistory = (messages: ReadonlyArray<UiMessage>): Array<ChatMessage> =>
  messages
    .filter((message) => !message.failed && message.content.length > 0)
    .map(({ role, content }) => ({ role, content }));

export function ChatApp({ articles }: { articles: ReadonlyArray<Article> }) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [messages, setMessages] = useState<ReadonlyArray<UiMessage>>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const updateMessage = (id: string, update: (message: UiMessage) => UiMessage) =>
    setMessages((current) =>
      current.map((message) => (message.id === id ? update(message) : message)),
    );

  const send = async (text: string) => {
    const user: UiMessage = { id: crypto.randomUUID(), role: "user", content: text, passages: [] };
    const assistantId = crypto.randomUUID();
    const history = toHistory([...messages, user]);
    setMessages([
      ...messages,
      user,
      { id: assistantId, role: "assistant", content: "", passages: [] },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history, articleIds: [...selectedIds] }),
        signal: controller.signal,
      });
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
      for await (const event of readSse(response.body)) {
        switch (event._tag) {
          case "Citations":
            updateMessage(assistantId, (message) => ({
              ...message,
              passages: event.passages,
            }));
            break;
          case "Delta":
            updateMessage(assistantId, (message) => ({
              ...message,
              content: message.content + event.text,
            }));
            break;
          case "Failed":
            updateMessage(assistantId, (message) => ({
              ...message,
              content: event.message,
              failed: true,
            }));
            break;
          case "Done":
            break;
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        updateMessage(assistantId, (message) => ({
          ...message,
          content: "Something went wrong. Try again.",
          failed: true,
        }));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  };

  const toggle = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold tracking-tight">rag-ai-chat</h1>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            selectedIds.size > 0
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          {selectedIds.size > 0
            ? `Grounded · ${selectedIds.size} article${selectedIds.size === 1 ? "" : "s"}`
            : "Plain chat"}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <ArticlePicker
          articles={articles}
          selectedIds={selectedIds}
          onToggle={toggle}
          onSelectAll={(ids) => setSelectedIds(new Set([...selectedIds, ...ids]))}
          onClear={() => setSelectedIds(new Set())}
        />
        <ChatPanel
          messages={messages}
          streaming={streaming}
          onSend={send}
          onStop={() => abortRef.current?.abort()}
        />
      </div>
    </div>
  );
}

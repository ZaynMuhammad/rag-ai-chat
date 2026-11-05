"use client";

import { type FormEvent, type KeyboardEvent, useState } from "react";
import type { Passage } from "@/rag/Article";

export interface UiMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly passages: ReadonlyArray<Passage>;
  readonly failed?: boolean;
}

function Sources({ passages }: { passages: ReadonlyArray<Passage> }) {
  if (passages.length === 0) return null;
  return (
    <ol className="mt-3 space-y-1 border-t border-zinc-200 pt-2 text-xs dark:border-zinc-700">
      {passages.map((passage, index) => (
        <li key={passage.articleId}>
          <a
            href={passage.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-600 hover:underline dark:text-zinc-300"
          >
            [{index + 1}] {passage.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

function Message({ message, pending }: { message: UiMessage; pending: boolean }) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-zinc-900 px-4 py-2 text-sm whitespace-pre-wrap text-white dark:bg-zinc-100 dark:text-zinc-900">
        {message.content}
      </div>
    );
  }
  return (
    <div
      className={`max-w-[85%] rounded-2xl rounded-bl-sm border px-4 py-2 text-sm whitespace-pre-wrap ${
        message.failed
          ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      {message.content === "" && pending ? (
        <span className="text-zinc-400">Thinking…</span>
      ) : (
        message.content
      )}
      <Sources passages={message.passages} />
    </div>
  );
}

export function ChatPanel({
  messages,
  streaming,
  onSend,
  onStop,
}: {
  messages: ReadonlyArray<UiMessage>;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [draft, setDraft] = useState("");
  const lastId = messages.at(-1)?.id;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (text === "" || streaming) return;
    setDraft("");
    onSend(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
          {messages.length === 0 ? (
            <div className="my-auto py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              <p className="font-medium text-zinc-700 dark:text-zinc-200">Ask anything.</p>
              <p className="mt-1">
                Select articles on the left to ground answers in Wikipedia, with citations.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <Message
                key={message.id}
                message={message}
                pending={streaming && message.id === lastId}
              />
            ))
          )}
        </div>
      </div>
      <form
        onSubmit={submit}
        className="border-t border-zinc-200 p-4 dark:border-zinc-800"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={4000}
            placeholder="Message"
            aria-label="Message"
            className="max-h-40 min-h-10 flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={draft.trim() === ""}
              className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </main>
  );
}

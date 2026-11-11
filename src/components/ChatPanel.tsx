"use client";

import Link from "next/link";
import {
  type KeyboardEvent,
  type SyntheticEvent,
  useRef,
  useState,
} from "react";
import { answerSegments } from "@/lib/citations";
import { formatReleased } from "@/lib/release";
import { fetchWithSession } from "@/lib/session";
import type { ChatMessage } from "@/server/chat/ChatProtocol";
import { readSse } from "@/server/chat/sse";
import type { Scope } from "@/server/games/Scope";
import type { RetrievedPassage } from "@/server/search/Passage";

interface UiMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly passages: ReadonlyArray<RetrievedPassage>;
  readonly model: string | null;
  readonly failed: boolean;
}

const toHistory = (messages: ReadonlyArray<UiMessage>): Array<ChatMessage> =>
  messages
    .filter((message) => !message.failed && message.content !== "")
    .slice(-10)
    .map(({ role, content }) => ({ role, content }));

const passageHref = (passage: RetrievedPassage) =>
  `/games/${passage.gameQid}#${encodeURIComponent(passage.id)}`;

const shortHeading = (passage: RetrievedPassage) =>
  passage.heading.startsWith(`${passage.title} > `)
    ? passage.heading.slice(passage.title.length + 3)
    : "Overview";

function Answer({ message }: { message: UiMessage }) {
  return (
    <p className="whitespace-pre-wrap leading-relaxed">
      {answerSegments(message.content, message.passages.length).map(
        (segment, index) => {
          if (segment.kind === "text")
            return <span key={index}>{segment.text}</span>;
          const passage = message.passages[segment.number - 1];
          return passage === undefined ? null : (
            <Link
              key={index}
              href={passageHref(passage)}
              title={`${passage.title}: ${shortHeading(passage)}`}
              className="mx-0.5 rounded bg-accent/15 px-1 align-super text-[0.7em] font-semibold text-accent hover:bg-accent/25"
            >
              {segment.number}
            </Link>
          );
        },
      )}
    </p>
  );
}

function Sources({ passages }: { passages: ReadonlyArray<RetrievedPassage> }) {
  if (passages.length === 0) return null;
  return (
    <details className="mt-3 border-t border-line pt-2 text-xs text-muted">
      <summary className="cursor-pointer select-none">
        {passages.length} passages retrieved
      </summary>
      <ol className="mt-2 space-y-1">
        {passages.map((passage, index) => (
          <li key={passage.id} className="flex gap-2">
            <span className="w-4 shrink-0 text-right font-semibold">
              {index + 1}
            </span>
            <Link href={passageHref(passage)} className="hover:underline">
              <span className="font-medium text-ink">{passage.title}</span> ·{" "}
              {shortHeading(passage)} · {formatReleased(passage.released)}
            </Link>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Bubble({
  message,
  pending,
}: {
  message: UiMessage;
  pending: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-4 py-2 text-sm whitespace-pre-wrap text-paper">
        {message.content}
      </div>
    );
  }
  return (
    <div
      className={`max-w-[92%] rounded-2xl rounded-bl-sm border px-4 py-3 text-sm ${
        message.failed
          ? "border-red-400/60 bg-red-500/10"
          : "border-line bg-card"
      }`}
    >
      {message.content === "" && pending ? (
        <span className="text-muted">Searching the articles…</span>
      ) : (
        <Answer message={message} />
      )}
      {message.model !== null && (
        <p className="mt-2 text-[11px] text-muted">
          Answered by <code>{message.model}</code>
          {message.model.startsWith("mock") && " (quotes the passages, no LLM)"}
        </p>
      )}
      <Sources passages={message.passages} />
    </div>
  );
}

export function ChatPanel({
  scope,
  placeholder,
  suggestions,
}: {
  scope: Scope;
  placeholder: string;
  suggestions: ReadonlyArray<string>;
}) {
  const [messages, setMessages] = useState<ReadonlyArray<UiMessage>>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastId = messages.at(-1)?.id;

  const update = (id: string, change: (message: UiMessage) => UiMessage) => {
    setMessages((current) =>
      current.map((message) => (message.id === id ? change(message) : message)),
    );
  };

  const send = async (text: string) => {
    const user: UiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      passages: [],
      model: null,
      failed: false,
    };
    const assistantId = crypto.randomUUID();
    const history = toHistory([...messages, user]);
    setMessages([
      ...messages,
      user,
      { ...user, id: assistantId, role: "assistant", content: "" },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    try {
      const response = await fetchWithSession("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history, scope }),
        signal: controller.signal,
      });
      if (response.status === 429) {
        update(assistantId, (message) => ({
          ...message,
          content: "You're asking quickly. Wait a moment and try again.",
          failed: true,
        }));
        return;
      }
      if (!response.ok || response.body === null)
        throw new Error(`HTTP ${response.status}`);
      for await (const event of readSse(response.body)) {
        switch (event._tag) {
          case "Citations":
            update(assistantId, (message) => ({
              ...message,
              passages: event.passages,
            }));
            break;
          case "Delta":
            update(assistantId, (message) => ({
              ...message,
              content: message.content + event.text,
            }));
            break;
          case "Failed":
            update(assistantId, (message) => ({
              ...message,
              content: `${message.content}\n\n${event.message}`.trim(),
              failed: true,
            }));
            break;
          case "Done":
            update(assistantId, (message) => ({
              ...message,
              model: event.model,
            }));
            break;
        }
      }
    } catch {
      if (controller.signal.aborted) {
        setMessages((current) =>
          current.filter(
            (message) => message.id !== assistantId || message.content !== "",
          ),
        );
      } else {
        update(assistantId, (message) => ({
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

  const submit = (event?: SyntheticEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (text === "" || streaming) return;
    setDraft("");
    void send(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    )
      submit(event);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
        <div className="flex flex-col gap-4 p-4">
          {messages.length === 0 ? (
            <div className="py-6 text-sm text-muted">
              <p>
                Answers come only from the retrieved Wikipedia passages, with
                numbered citations.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="rounded-full border border-line px-3 py-1 text-xs hover:border-accent hover:text-accent"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <Bubble
                key={message.id}
                message={message}
                pending={streaming && message.id === lastId}
              />
            ))
          )}
        </div>
      </div>
      <form onSubmit={submit} className="border-t border-line p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={2000}
            placeholder={placeholder}
            aria-label="Question"
            className="max-h-40 min-h-10 flex-1 resize-none rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {streaming ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="h-10 rounded-lg border border-line px-4 text-sm font-medium"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={draft.trim() === ""}
              className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-40"
            >
              Ask
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

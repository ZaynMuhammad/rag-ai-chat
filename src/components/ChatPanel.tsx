"use client";

import { ArrowUpIcon, SquareIcon } from "lucide-react";
import Link from "next/link";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type CitedPassage, citedPassage, type UiMessage } from "@/lib/chats";
import { answerSegments } from "@/lib/citations";
import { formatReleased } from "@/lib/release";
import { fetchWithSession } from "@/lib/session";
import type { ChatMessage } from "@/server/chat/ChatProtocol";
import { readSse } from "@/server/chat/sse";
import type { Scope } from "@/server/games/Scope";

export type CiteHandler = (passage: CitedPassage) => boolean;

const toHistory = (messages: ReadonlyArray<UiMessage>): Array<ChatMessage> =>
  messages
    .filter((message) => !message.failed && message.content !== "")
    .slice(-10)
    .map(({ role, content }) => ({ role, content }));

const passageHref = (passage: CitedPassage) =>
  `/games/${passage.gameQid}#${encodeURIComponent(passage.id)}`;

const shortHeading = (passage: CitedPassage) =>
  passage.heading.startsWith(`${passage.title} > `)
    ? passage.heading.slice(passage.title.length + 3)
    : "Overview";

function PassageLink({
  passage,
  onCite,
  className,
  title,
  children,
}: {
  passage: CitedPassage;
  onCite: CiteHandler | undefined;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const onClick = (event: MouseEvent) => {
    if (onCite?.(passage) === true) event.preventDefault();
  };
  return (
    <Link
      href={passageHref(passage)}
      onClick={onClick}
      {...(title === undefined ? {} : { title })}
      {...(className === undefined ? {} : { className })}
    >
      {children}
    </Link>
  );
}

function Answer({
  message,
  onCite,
}: {
  message: UiMessage;
  onCite: CiteHandler | undefined;
}) {
  return (
    <p className="leading-relaxed whitespace-pre-wrap">
      {answerSegments(message.content, message.passages.length).map(
        (segment, index) => {
          if (segment.kind === "text")
            return <span key={index}>{segment.text}</span>;
          const passage = message.passages[segment.number - 1];
          return passage === undefined ? null : (
            <PassageLink
              key={index}
              passage={passage}
              onCite={onCite}
              title={`${passage.title}: ${shortHeading(passage)}`}
              className="mx-0.5 rounded bg-primary/15 px-1 align-super text-[0.7em] font-semibold text-primary hover:bg-primary/25"
            >
              {segment.number}
            </PassageLink>
          );
        },
      )}
    </p>
  );
}

function Sources({
  passages,
  onCite,
}: {
  passages: ReadonlyArray<CitedPassage>;
  onCite: CiteHandler | undefined;
}) {
  if (passages.length === 0) return null;
  return (
    <details className="mt-3 border-t pt-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">
        {passages.length} passages retrieved
      </summary>
      <ol className="mt-2 space-y-1">
        {passages.map((passage, index) => (
          <li key={passage.id} className="flex gap-2">
            <span className="w-4 shrink-0 text-right font-semibold">
              {index + 1}
            </span>
            <PassageLink
              passage={passage}
              onCite={onCite}
              className="hover:underline"
            >
              <span className="font-medium text-foreground">
                {passage.title}
              </span>{" "}
              · {shortHeading(passage)} · {formatReleased(passage.released)}
            </PassageLink>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Bubble({
  message,
  pending,
  onCite,
}: {
  message: UiMessage;
  pending: boolean;
  onCite: CiteHandler | undefined;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-foreground px-4 py-2 text-sm whitespace-pre-wrap text-background">
        {message.content}
      </div>
    );
  }
  return (
    <div
      className={`max-w-[92%] rounded-2xl rounded-bl-sm border px-4 py-3 text-sm ${
        message.failed ? "border-destructive/60 bg-destructive/10" : "bg-card"
      }`}
    >
      {message.content === "" && pending ? (
        <span className="text-muted-foreground">Searching the articles…</span>
      ) : (
        <Answer message={message} onCite={onCite} />
      )}
      {message.model !== null && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Answered by <code>{message.model}</code>
          {message.model.startsWith("mock") && " (quotes the passages, no LLM)"}
        </p>
      )}
      <Sources passages={message.passages} onCite={onCite} />
    </div>
  );
}

const blankMessage = (role: UiMessage["role"], content: string): UiMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  passages: [],
  model: null,
  failed: false,
});

export function ChatPanel({
  scope,
  placeholder,
  initialMessages,
  onSave,
  onCite,
  emptyState,
  suggestions = [],
}: {
  scope: Scope;
  placeholder: string;
  suggestions?: ReadonlyArray<string>;
  initialMessages: ReadonlyArray<UiMessage>;
  onSave: (messages: ReadonlyArray<UiMessage>) => void;
  onCite?: CiteHandler;
  emptyState: ReactNode;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastId = messages.at(-1)?.id;

  const send = async (text: string) => {
    const user = blankMessage("user", text);
    const before = [...messages, user];
    let assistant = blankMessage("assistant", "");
    const update = (change: (message: UiMessage) => UiMessage) => {
      assistant = change(assistant);
      setMessages([...before, assistant]);
    };
    setMessages([...before, assistant]);
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    try {
      const response = await fetchWithSession("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: toHistory(before), scope }),
        signal: controller.signal,
      });
      if (response.status === 429) {
        update((message) => ({
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
            update((message) => ({
              ...message,
              passages: event.passages.map(citedPassage),
            }));
            break;
          case "Delta":
            update((message) => ({
              ...message,
              content: message.content + event.text,
            }));
            break;
          case "Failed":
            update((message) => ({
              ...message,
              content: `${message.content}\n\n${event.message}`.trim(),
              failed: true,
            }));
            break;
          case "Done":
            update((message) => ({ ...message, model: event.model }));
            break;
        }
      }
    } catch {
      if (controller.signal.aborted) {
        if (assistant.content === "") setMessages(before);
      } else {
        update((message) => ({
          ...message,
          content: "Something went wrong. Try again.",
          failed: true,
        }));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      onSave(assistant.content === "" ? before : [...before, assistant]);
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
      {messages.length === 0 ? (
        <div className="relative min-h-0 flex-1">{emptyState}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
            {messages.map((message) => (
              <Bubble
                key={message.id}
                message={message}
                pending={streaming && message.id === lastId}
                onCite={onCite}
              />
            ))}
          </div>
        </div>
      )}
      <form onSubmit={submit} className="p-3">
        {messages.length === 0 && suggestions.length > 0 && (
          <div className="mx-auto mb-2 flex w-full max-w-3xl flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => void send(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        )}
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm focus-within:border-ring">
          <Textarea
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={2000}
            placeholder={placeholder}
            aria-label="Question"
            className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          {streaming ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Stop"
              onClick={() => abortRef.current?.abort()}
            >
              <SquareIcon />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              aria-label="Send"
              disabled={draft.trim() === ""}
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

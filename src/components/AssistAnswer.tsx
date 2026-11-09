"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { answerSegments } from "@/lib/citations";
import { fetchWithSession } from "@/lib/session";
import { readSse } from "@/server/chat/sse";
import type { RetrievedPassage } from "@/server/search/Passage";
import { passageHref } from "./SearchResultList";

interface Assist {
  readonly text: string;
  readonly passages: ReadonlyArray<RetrievedPassage>;
  readonly model: string | null;
  readonly status: "streaming" | "done" | "failed";
}

const starting: Assist = {
  text: "",
  passages: [],
  model: null,
  status: "streaming",
};

const streamAssist = async (
  question: string,
  signal: AbortSignal,
  update: (change: (assist: Assist) => Assist) => void,
) => {
  const response = await fetchWithSession("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: question }],
      scope: {},
    }),
    signal,
  });
  if (!response.ok || response.body === null) {
    update((assist) => ({
      ...assist,
      text:
        response.status === 429
          ? "Too many answers in a short time. The results below are still here."
          : "The answer could not be loaded. The results below are still here.",
      status: "failed",
    }));
    return;
  }
  for await (const event of readSse(response.body)) {
    switch (event._tag) {
      case "Citations":
        update((assist) => ({ ...assist, passages: event.passages }));
        break;
      case "Delta":
        update((assist) => ({ ...assist, text: assist.text + event.text }));
        break;
      case "Failed":
        update((assist) => ({
          ...assist,
          text: event.message,
          status: "failed",
        }));
        break;
      case "Done":
        update((assist) => ({ ...assist, model: event.model, status: "done" }));
        break;
    }
  }
};

function Answer({ assist }: { assist: Assist }) {
  if (assist.text === "")
    return <p className="text-muted-foreground">Reading the top passages…</p>;
  return (
    <p className="leading-relaxed whitespace-pre-wrap">
      {answerSegments(assist.text, assist.passages.length).map(
        (segment, index) => {
          if (segment.kind === "text")
            return <span key={index}>{segment.text}</span>;
          const passage = assist.passages[segment.number - 1];
          return passage === undefined ? null : (
            <Link
              key={index}
              href={passageHref(passage.gameQid, passage.id)}
              title={passage.title}
              className="mx-0.5 rounded bg-primary/15 px-1 align-super text-[0.7em] font-semibold text-primary hover:bg-primary/25"
            >
              {segment.number}
            </Link>
          );
        },
      )}
    </p>
  );
}

export function AssistAnswer({
  question,
  confidence,
}: {
  question: string;
  confidence: number;
}) {
  const [assist, setAssist] = useState(starting);

  useEffect(() => {
    const controller = new AbortController();
    streamAssist(question, controller.signal, setAssist).catch(() => {
      if (!controller.signal.aborted)
        setAssist((current) => ({
          ...current,
          text: "The answer could not be loaded. The results below are still here.",
          status: "failed",
        }));
    });
    return () => {
      controller.abort();
    };
  }, [question]);

  return (
    <section
      aria-label="Assist"
      aria-busy={assist.status === "streaming"}
      className={`rounded-lg border p-4 text-sm ${
        assist.status === "failed"
          ? "border-destructive/40 bg-destructive/5"
          : "border-primary/30 bg-primary/5"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold tracking-wide text-primary uppercase">
          Assist
        </span>
        <span className="text-muted-foreground">
          {Math.round(confidence * 100)}% retrieval confidence
        </span>
      </div>
      <Answer assist={assist} />
      {assist.passages.length > 0 && (
        <ol className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
          {assist.passages.map((passage, index) => (
            <li key={passage.id} className="flex gap-2">
              <span className="w-4 shrink-0 text-right font-semibold">
                {index + 1}
              </span>
              <Link
                href={passageHref(passage.gameQid, passage.id)}
                className="min-w-0 truncate hover:underline"
              >
                {passage.title} · {passage.heading}
              </Link>
            </li>
          ))}
        </ol>
      )}
      {assist.model !== null && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Answered by <code>{assist.model}</code>
          {assist.model.startsWith("mock") && " (quotes the passages, no LLM)"}
        </p>
      )}
    </section>
  );
}

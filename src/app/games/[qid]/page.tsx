import { Effect, Option } from "effect";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { formatReleased } from "@/lib/release";
import { GameCatalog } from "@/server/games/GameCatalog";
import type { GameDetail } from "@/server/games/GameProtocol";
import { runAtRequestTime } from "@/app/run";

const sectionName = (game: GameDetail, heading: string) =>
  heading.startsWith(`${game.title} > `)
    ? heading.slice(game.title.length + 3)
    : null;

function Article({ game }: { game: GameDetail }) {
  const places = [...new Set(game.origins.map((origin) => origin.country))];
  const regions = [...new Set(game.origins.map((origin) => origin.subRegion))];
  return (
    <article className="min-w-0">
      <p className="text-sm font-medium text-primary">
        {formatReleased(game.released)}
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">
        {game.title}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {places.join(", ")} · {regions.join(", ")}
      </p>
      {game.description !== null && (
        <p className="mt-1 text-sm text-muted-foreground">{game.description}</p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        From{" "}
        {game.url !== null && (
          <a href={game.url} className="underline" rel="noreferrer">
            the Wikipedia article
          </a>
        )}
        {game.revisionId !== null && (
          <>
            {" "}
            (
            <a
              href={`https://en.wikipedia.org/w/index.php?oldid=${game.revisionId}`}
              className="underline"
              rel="noreferrer"
            >
              revision {game.revisionId}
            </a>
            )
          </>
        )}
        , CC BY-SA 4.0.
      </p>
      <div className="mt-6 space-y-6">
        {game.passages.map((passage) => {
          const name = sectionName(game, passage.heading);
          return (
            <section
              key={passage.id}
              id={passage.id}
              className="scroll-mt-20 rounded-md target:bg-primary/10 target:p-3"
            >
              {name !== null && (
                <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                  {name}
                </h2>
              )}
              {passage.text.split("\n\n").map((paragraph, index) => (
                <p
                  key={index}
                  className="mb-3 leading-relaxed whitespace-pre-line"
                >
                  {paragraph}
                </p>
              ))}
            </section>
          );
        })}
      </div>
    </article>
  );
}

const findGame = (qid: string) =>
  runAtRequestTime(
    Effect.flatMap(GameCatalog, (catalog) => catalog.game(qid)).pipe(
      Effect.option,
    ),
  );

export async function generateMetadata({
  params,
}: PageProps<"/games/[qid]">): Promise<Metadata> {
  const game = await findGame((await params).qid);
  if (Option.isNone(game)) notFound();
  return {
    title: `${game.value.title} · Game Atlas`,
    description: game.value.description ?? undefined,
  };
}

async function Game({ params }: { params: Promise<{ qid: string }> }) {
  const game = await findGame((await params).qid);
  if (Option.isNone(game)) notFound();
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Article game={game.value} />
      <aside className="lg:sticky lg:top-4 lg:h-[calc(100dvh-6rem)]">
        <div className="flex h-[32rem] flex-col rounded-lg border border-border bg-card lg:h-full">
          <p className="border-b border-border px-4 py-2 text-sm font-medium">
            Ask about {game.value.title}
          </p>
          <ChatPanel
            scope={{ gameQid: game.value.qid }}
            placeholder={`Ask about ${game.value.title}`}
            suggestions={[
              `Who developed ${game.value.title}?`,
              `How was ${game.value.title} received?`,
            ]}
          />
        </div>
      </aside>
    </div>
  );
}

export default function GamePage({ params }: PageProps<"/games/[qid]">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-primary"
      >
        ← All games
      </Link>
      <div className="mt-4">
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">Loading article…</p>
          }
        >
          <Game params={params} />
        </Suspense>
      </div>
    </main>
  );
}

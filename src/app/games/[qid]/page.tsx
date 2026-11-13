import { Effect, Option } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArticleMeta, ArticleText } from "@/components/atlas/Article";
import { GameChat } from "@/components/atlas/GameChat";
import { SiteHeader } from "@/components/SiteHeader";
import { linkPreview, siteDescription } from "@/lib/siteMetadata";
import { RevealHashPassage } from "@/components/atlas/RevealHashPassage";
import { GameCatalog } from "@/server/games/GameCatalog";
import { runAtRequestTime } from "@/app/run";

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
  const { title, description } = game.value;
  return {
    title: `${title} · Game Atlas`,
    description: description ?? undefined,
    ...linkPreview(title, description ?? siteDescription),
  };
}

async function Game({ params }: { params: Promise<{ qid: string }> }) {
  const game = await findGame((await params).qid);
  if (Option.isNone(game)) notFound();
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <article className="min-w-0">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight">
          {game.value.title}
        </h1>
        <ArticleMeta game={game.value} />
        <div className="mt-6">
          <ArticleText game={game.value} />
        </div>
        <RevealHashPassage />
      </article>
      <aside className="lg:sticky lg:top-4 lg:h-[calc(100dvh-6rem)]">
        <div className="flex h-[32rem] flex-col rounded-xl border bg-card lg:h-full">
          <GameChat
            game={{ qid: game.value.qid, title: game.value.title }}
            chatId={crypto.randomUUID()}
          />
        </div>
      </aside>
    </div>
  );
}

export default function GamePage({ params }: PageProps<"/games/[qid]">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <SiteHeader />
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">Loading article…</p>
        }
      >
        <Game params={params} />
      </Suspense>
    </main>
  );
}

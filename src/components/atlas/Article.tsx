import { Badge } from "@/components/ui/badge";
import { formatReleased } from "@/lib/release";
import type { GameDetail } from "@/server/games/GameProtocol";

const sectionName = (game: GameDetail, heading: string) =>
  heading.startsWith(`${game.title} > `)
    ? heading.slice(game.title.length + 3)
    : null;

export const passageHighlight = [
  {
    backgroundColor: "color-mix(in oklch, var(--primary) 18%, transparent)",
  },
  { backgroundColor: "transparent" },
];

export const revealPassage = (section: HTMLElement | null) => {
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
  section?.animate(passageHighlight, { duration: 1600, easing: "ease-out" });
};

const unique = (values: ReadonlyArray<string>) => [...new Set(values)];

export function ArticleMeta({ game }: { game: GameDetail }) {
  const studios = unique(
    game.studios.map((studio) => `${studio.developer}, ${studio.place}`),
  );
  const countries = unique(game.origins.map((origin) => origin.country));
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-primary">
        {formatReleased(game.released)}
      </p>
      {game.genres.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {game.genres.map((genre) => (
            <Badge key={genre} variant="secondary" className="font-normal">
              {genre}
            </Badge>
          ))}
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {studios.length > 0 ? studios.join(" · ") : countries.join(", ")}
      </p>
      {game.description !== null && (
        <p className="text-sm text-muted-foreground">{game.description}</p>
      )}
      <p className="text-xs text-muted-foreground">
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
    </div>
  );
}

export function ArticleText({ game }: { game: GameDetail }) {
  return (
    <div className="space-y-6">
      {game.passages.map((passage) => {
        const name = sectionName(game, passage.heading);
        return (
          <section
            key={passage.id}
            id={passage.id}
            className="scroll-mt-4 rounded-md transition-colors target:bg-primary/10 target:p-3"
          >
            {name !== null && (
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                {name}
              </h3>
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
  );
}

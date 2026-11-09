import Link from "next/link";
import { formatReleased } from "@/lib/release";
import type { SearchHit } from "@/server/search/SearchProtocol";

const sectionName = (hit: SearchHit) =>
  hit.heading.startsWith(`${hit.title} > `)
    ? hit.heading.slice(hit.title.length + 3)
    : "Overview";

export const passageHref = (gameQid: string, passageId: string) =>
  `/games/${gameQid}#${encodeURIComponent(passageId)}`;

function Snippet({ hit }: { hit: SearchHit }) {
  return (
    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
      {hit.snippet.map((segment, index) =>
        segment.matched ? (
          <mark
            key={index}
            className="bg-transparent font-semibold text-foreground"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

export function SearchResultList({
  results,
}: {
  results: ReadonlyArray<SearchHit>;
}) {
  if (results.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No game articles match those words.
      </p>
    );
  }
  return (
    <ol className="space-y-6">
      {results.map((hit) => (
        <li key={hit.qid} className="min-w-0">
          <Link
            href={passageHref(hit.qid, hit.passageId)}
            className="text-base font-medium text-primary hover:underline"
          >
            {hit.title}
          </Link>
          <p className="text-xs text-muted-foreground">
            {formatReleased(hit.released)} · {sectionName(hit)}
          </p>
          <Snippet hit={hit} />
          {hit.revisionId !== null && (
            <a
              href={`https://en.wikipedia.org/w/index.php?oldid=${hit.revisionId}`}
              rel="noreferrer"
              className="mt-1 inline-block text-xs text-muted-foreground underline hover:text-foreground"
            >
              Wikipedia, revision {hit.revisionId}
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}

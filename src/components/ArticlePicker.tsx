"use client";

import { useState } from "react";
import type { Article } from "@/rag/Article";

export function ArticlePicker({
  articles,
  selectedIds,
  onToggle,
  onSelectAll,
  onClear,
}: {
  articles: ReadonlyArray<Article>;
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelectAll: (ids: ReadonlyArray<string>) => void;
  onClear: () => void;
}) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const visible = articles.filter(
    (article) =>
      needle === "" ||
      article.title.toLowerCase().includes(needle) ||
      article.summary.toLowerCase().includes(needle),
  );

  return (
    <aside className="flex max-h-[40dvh] flex-col border-b border-zinc-200 md:max-h-none md:w-80 md:border-r md:border-b-0 dark:border-zinc-800">
      <div className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Articles</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Selected articles are the corpus grounded answers retrieve from.
          </p>
        </div>
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter articles"
          aria-label="Filter articles"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">
            {selectedIds.size} of {articles.length} selected
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => onSelectAll(visible.map((article) => article.id))}
              className="font-medium hover:underline"
            >
              Select shown
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={selectedIds.size === 0}
              className="font-medium hover:underline disabled:opacity-40 disabled:hover:no-underline"
            >
              Clear
            </button>
          </div>
        </div>
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {visible.map((article) => {
          const selected = selectedIds.has(article.id);
          return (
            <li key={article.id}>
              <label
                className={`flex cursor-pointer gap-3 rounded-md px-2 py-2 ${
                  selected
                    ? "bg-emerald-50 dark:bg-emerald-950/40"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggle(article.id)}
                  className="mt-0.5 accent-emerald-600"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{article.title}</span>
                  <span className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {article.summary}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-2 py-4 text-xs text-zinc-500">No articles match “{filter}”.</li>
        )}
      </ul>
    </aside>
  );
}

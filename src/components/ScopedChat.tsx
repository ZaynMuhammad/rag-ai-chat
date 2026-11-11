"use client";

import { useState } from "react";
import type { SubRegionCount } from "@/server/games/GameCatalog";
import type { Scope } from "@/server/games/Scope";
import { AreaOptions } from "./AreaSelect";
import { ChatPanel } from "./ChatPanel";

const field =
  "h-9 rounded-md border border-border bg-card px-2 text-sm outline-none focus:border-primary";

const parseArea = (value: string): Pick<Scope, "region" | "subRegion"> => {
  const [region, subRegion] = value.split("|");
  if (region === undefined || region === "") return {};
  return subRegion === undefined ? { region } : { region, subRegion };
};

const parseYear = (value: string) => {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1940 && year <= 2100
    ? year
    : undefined;
};

export function ScopedChat({
  initialArea,
  initialFrom,
  initialTo,
  subRegions,
}: {
  initialArea: string;
  initialFrom: string;
  initialTo: string;
  subRegions: ReadonlyArray<SubRegionCount>;
}) {
  const [area, setArea] = useState(initialArea);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const fromYear = parseYear(from);
  const toYear = parseYear(to);
  const scope: Scope = {
    ...parseArea(area),
    ...(fromYear === undefined ? {} : { from: fromYear }),
    ...(toYear === undefined ? {} : { to: toYear }),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Only games from
          <select
            value={area}
            onChange={(event) => {
              setArea(event.target.value);
            }}
            className={field}
          >
            <AreaOptions subRegions={subRegions} />
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Released from
          <input
            type="number"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
            placeholder="1940"
            className={`${field} w-24`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          to
          <input
            type="number"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
            placeholder="2026"
            className={`${field} w-24`}
          />
        </label>
      </div>
      <ChatPanel
        scope={scope}
        placeholder="Ask about video games"
        suggestions={[
          "Which country was Tetris created in?",
          "Who designed the first Metal Gear game?",
          "What was the first game made in Estonia?",
        ]}
      />
    </div>
  );
}

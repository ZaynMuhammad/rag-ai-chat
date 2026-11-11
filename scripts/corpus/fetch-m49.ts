import { writeFile } from "node:fs/promises";

const sourceUrl = "https://unstats.un.org/unsd/methodology/m49/overview/";
const outputPath = new URL("../../src/corpus/m49.json", import.meta.url);

const decodeEntities = (text: string) =>
  text
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

const cellsOf = (row: string) =>
  [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) =>
    decodeEntities((cell[1] ?? "").replaceAll(/<[^>]+>/g, "")).trim(),
  );

const html = await (await fetch(sourceUrl)).text();
const table = html.match(/<table id = "downloadTableEN"[\s\S]*?<\/table>/)?.[0];
if (table === undefined)
  throw new Error(`No English M49 table found at ${sourceUrl}`);

const [header, ...rows] = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(
  (row) => cellsOf(row[1] ?? ""),
);
const column = (name: string) => {
  const index = (header ?? []).indexOf(name);
  if (index === -1) throw new Error(`M49 table has no "${name}" column`);
  return index;
};

const iso2 = column("ISO-alpha2 Code");
const country = column("Country or Area");
const region = column("Region Name");
const subRegion = column("Sub-region Name");
const intermediateRegion = column("Intermediate Region Name");

const entries = rows
  .filter((cells) => cells[iso2] !== "")
  .map((cells) => ({
    iso2: cells[iso2] ?? "",
    country: cells[country] ?? "",
    region: cells[region] ?? "",
    subRegion: cells[subRegion] ?? "",
    intermediateRegion: cells[intermediateRegion] || null,
  }))
  .sort((a, b) => a.iso2.localeCompare(b.iso2));

await writeFile(outputPath, `${JSON.stringify(entries, null, 2)}\n`);
console.log(`Wrote ${entries.length} M49 areas to ${outputPath.pathname}`);

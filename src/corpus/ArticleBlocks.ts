import { Schema } from "effect";

export interface ArticlePart {
  readonly type: string;
  readonly name?: string;
  readonly value?: string;
  readonly has_parts?: ReadonlyArray<ArticlePart>;
}

export const ArticlePart = Schema.Struct({
  type: Schema.String,
  name: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(Schema.String),
  has_parts: Schema.optionalKey(
    Schema.Array(Schema.suspend((): Schema.Codec<ArticlePart> => ArticlePart)),
  ),
});

export const ArticleSections = Schema.fromJsonString(Schema.Array(ArticlePart));

export interface TextBlock {
  readonly sectionPath: ReadonlyArray<string>;
  readonly text: string;
}

const leadSectionName = "Abstract";
const listTypes = new Set(["list", "ordered_list"]);

const normalizeWhitespace = (text: string) =>
  text.replaceAll(/\s+/g, " ").trim();

const listLines = (list: ArticlePart, depth: number): ReadonlyArray<string> =>
  (list.has_parts ?? []).flatMap((item, index) => {
    const marker = list.type === "ordered_list" ? `${index + 1}.` : "-";
    const text = normalizeWhitespace(item.value ?? "");
    const own = text === "" ? [] : [`${"  ".repeat(depth)}${marker} ${text}`];
    const nested = (item.has_parts ?? []).filter((part) =>
      listTypes.has(part.type),
    );
    return [...own, ...nested.flatMap((part) => listLines(part, depth + 1))];
  });

const sectionBlocks = (
  section: ArticlePart,
  path: ReadonlyArray<string>,
): ReadonlyArray<TextBlock> =>
  (section.has_parts ?? []).flatMap((part): ReadonlyArray<TextBlock> => {
    if (part.type === "section")
      return sectionBlocks(part, [
        ...path,
        normalizeWhitespace(part.name ?? ""),
      ]);
    if (part.type === "paragraph") {
      const text = normalizeWhitespace(part.value ?? "");
      return text === "" ? [] : [{ sectionPath: path, text }];
    }
    if (listTypes.has(part.type)) {
      const lines = listLines(part, 0);
      return lines.length === 0
        ? []
        : [{ sectionPath: path, text: lines.join("\n") }];
    }
    return [];
  });

export const articleBlocks = (
  sections: ReadonlyArray<ArticlePart>,
): ReadonlyArray<TextBlock> =>
  sections.flatMap((section) =>
    sectionBlocks(
      section,
      section.name === leadSectionName
        ? []
        : [normalizeWhitespace(section.name ?? "")],
    ),
  );

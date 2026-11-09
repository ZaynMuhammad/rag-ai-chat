import type { Prompt } from "effect/ai";
import type { RetrievedPassage } from "@/server/search/Retriever";
import type { ChatMessage } from "./ChatProtocol";

export const instructions = [
  "You answer questions about video games using only the numbered Wikipedia passages in the user's last message.",
  "Cite every claim with the passage number in square brackets, like [2]. Cite only passages you used.",
  "If the passages do not answer the question, say that the articles you found don't cover it. Do not use outside knowledge.",
  "Answer in at most five sentences of plain text.",
].join("\n");

export interface PromptPassage {
  readonly number: number;
  readonly text: string;
}

export interface GroundedQuestion {
  readonly question: string;
  readonly passages: ReadonlyArray<PromptPassage>;
}

const flatten = (text: string) =>
  text.replaceAll(/<\/?(passage|question)[^>]*>/g, " ");

const attribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const renderPassage = (passage: RetrievedPassage, index: number) =>
  `<passage n="${index + 1}" title="${attribute(passage.heading)}"${
    passage.released === null ? "" : ` released="${passage.released}"`
  }>\n${flatten(passage.text)}\n</passage>`;

export const groundedTurn = (
  question: string,
  passages: ReadonlyArray<RetrievedPassage>,
) =>
  `${passages.map(renderPassage).join("\n\n")}\n\n<question>\n${flatten(question)}\n</question>`;

export const groundedPrompt = (
  messages: ReadonlyArray<ChatMessage>,
  passages: ReadonlyArray<RetrievedPassage>,
): ReadonlyArray<Prompt.MessageEncoded> => {
  const history = messages.slice(0, -1);
  const question = messages.at(-1)?.content ?? "";
  return [
    { role: "system", content: instructions },
    ...history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: "user", content: groundedTurn(question, passages) },
  ];
};

const passagePattern = /<passage n="(\d+)"[^>]*>\n([\s\S]*?)\n<\/passage>/g;
const questionPattern = /<question>\n([\s\S]*?)\n<\/question>/;

export const parseGroundedTurn = (text: string): GroundedQuestion => ({
  question: questionPattern.exec(text)?.[1] ?? "",
  passages: [...text.matchAll(passagePattern)].map((match) => ({
    number: Number(match[1]),
    text: match[2] ?? "",
  })),
});

export const lastUserText = (prompt: Prompt.Prompt) => {
  const last = prompt.content.findLast((message) => message.role === "user");
  return last?.role === "user"
    ? last.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
    : "";
};

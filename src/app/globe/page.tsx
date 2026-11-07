import type { Metadata } from "next";
import { Globe } from "./globe";

export const metadata: Metadata = { title: "Globe · rag-ai-chat" };

export default function GlobePage() {
  return (
    <main className="relative flex-1 overflow-hidden">
      <Globe />
    </main>
  );
}

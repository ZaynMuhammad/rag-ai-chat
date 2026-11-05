import { ChatApp } from "@/components/ChatApp";
import { catalog } from "@/rag/catalog";

export default function Home() {
  const articles = catalog.map(({ id, title, summary, url }) => ({ id, title, summary, url }));
  return <ChatApp articles={articles} />;
}

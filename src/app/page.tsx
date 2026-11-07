import { ChatApp } from "@/components/ChatApp";
import { catalog } from "@/rag/catalog";

export default function Home() {
  return <ChatApp articles={catalog} />;
}

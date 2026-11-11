import type { Metadata } from "next";
import { ProAccess } from "@/components/ProAccess";
import { maxBatchSize } from "@/server/pro/ProProtocol";

export const metadata: Metadata = { title: "Pro without identity" };

export default function ProPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold tracking-tight">
        Pro without identity
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Paste an access code. Your browser makes {maxBatchSize} random
        credentials and blinds them before sending, so the server signs them
        without seeing them. Each later chat session spends one, and the server
        cannot tell which code it came from.
      </p>
      <ProAccess />
    </main>
  );
}

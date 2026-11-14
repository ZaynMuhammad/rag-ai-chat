import type { Metadata } from "next";
import { ProAccess } from "@/components/ProAccess";
import { SiteHeader } from "@/components/SiteHeader";
import { maxBatchSize } from "@/server/pro/ProProtocol";

export const metadata: Metadata = {
  title: "Pro without identity · Game Atlas",
};

export default function ProPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <SiteHeader />
      <h1 className="text-xl font-semibold tracking-tight">
        Pro without identity
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Paste an access code. Your browser makes {maxBatchSize} random
        credentials and blinds them before sending, so the server signs them
        without seeing them. Each later chat session spends one, and the server
        cannot tell which code it came from.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        This demo doesn&apos;t hand out access codes. The page is here to show
        how Pro access works without linking it to you.
      </p>
      <ProAccess />
    </main>
  );
}

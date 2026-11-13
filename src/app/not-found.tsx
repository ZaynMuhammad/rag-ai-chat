import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not found · Game Atlas" };

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <SiteHeader />
      <div className="mt-18 text-center">
        <p className="text-sm font-semibold text-primary">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          This page isn&apos;t on the map
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may be mistyped, or the game isn&apos;t in the atlas.
        </p>
        <Link href="/" className={`${buttonVariants()} mt-6`}>
          Back to the globe
        </Link>
      </div>
    </main>
  );
}

import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export function SiteHeader() {
  return (
    <header className="mb-6 flex items-center justify-between gap-2">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-primary"
      >
        ← Back to the globe
      </Link>
      <ThemeToggle />
    </header>
  );
}

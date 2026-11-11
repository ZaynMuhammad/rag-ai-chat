import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Game Atlas",
  description:
    "Browse Wikipedia's video game articles by region and release date, and ask grounded questions with citations. No accounts, no tracking.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="font-semibold tracking-tight">
              Game<span className="text-accent">Atlas</span>
            </Link>
            <Link href="/" className="text-muted hover:text-ink">
              Browse
            </Link>
            <Link href="/chat" className="text-muted hover:text-ink">
              Ask
            </Link>
          </nav>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
        <footer className="border-t border-line">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted">
            Article text from Wikipedia, CC BY-SA 4.0. Regions from Wikidata and
            UN M49. No accounts, no cookies, no request logs.
          </p>
        </footer>
      </body>
    </html>
  );
}

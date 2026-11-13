import type { Metadata } from "next";

export const siteName = "Game Atlas";

export const siteDescription =
  "Explore Wikipedia's video game articles on a globe of the studios that made them, and ask grounded questions with citations. No accounts, no tracking.";

export const siteUrl = new URL(
  process.env["SITE_URL"] ?? "http://localhost:3000",
);

const previewImage = {
  url: "/og.jpg",
  width: 1200,
  height: 630,
  alt: "A globe dotted with the places video games were made",
};

export const linkPreview = (
  title: string,
  description: string,
): Pick<Metadata, "openGraph" | "twitter"> => ({
  openGraph: {
    type: "website",
    siteName,
    title,
    description,
    images: [previewImage],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [previewImage],
  },
});

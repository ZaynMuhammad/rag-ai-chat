import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  htmlLimitedBots: /.*/,
  poweredByHeader: false,
  partialPrefetching: true,
  headers: () =>
    Promise.resolve([
      {
        source: "/search",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ]),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

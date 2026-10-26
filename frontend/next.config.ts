import type { NextConfig } from "next";

// ARENIX_STATIC=1 builds plain files (out/) that the game server serves itself, so the whole
// game deploys as one service. Without it, Next runs its own standalone server (local dev, Docker).
const staticExport = process.env.ARENIX_STATIC === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: staticExport ? "export" : "standalone",
  // Static hosting serves /leaderboard/ as leaderboard/index.html.
  trailingSlash: staticExport,
  images: { unoptimized: staticExport },
};

export default nextConfig;

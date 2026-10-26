#!/usr/bin/env node
/**
 * Build the upload for a game portal: a single index.html that loads the portal's SDK and embeds
 * the game from your ARENIX server.
 *
 *   node scripts/build-portal.mjs crazygames https://your-arenix.onrender.com
 *   node scripts/build-portal.mjs poki       https://your-arenix.onrender.com
 *   node scripts/build-portal.mjs itch       https://your-arenix.onrender.com
 *
 * Output: portal-build/<portal>/index.html — zip that folder and upload it to the portal.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SDKS = {
  crazygames: "https://sdk.crazygames.com/crazygames-sdk-v3.js",
  poki: "https://game-cdn.poki.com/scripts/v2/poki-sdk.js",
  itch: null,
};

const [portal, gameUrl] = process.argv.slice(2);
if (!(portal in SDKS) || !gameUrl) {
  console.error("usage: node scripts/build-portal.mjs <crazygames|poki|itch> <https://your-game-server>");
  process.exit(1);
}
let url;
try {
  url = new URL(gameUrl);
} catch {
  console.error(`not a URL: ${gameUrl}`);
  process.exit(1);
}
if (url.protocol !== "https:") {
  console.error("the game URL must use https:// (portals are served over https)");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sdk = SDKS[portal];
const html = readFileSync(join(root, "portal", "launcher.html"), "utf8")
  .replaceAll("__SDK_SCRIPT__", sdk ? `\n  <script src="${sdk}"></script>` : "")
  .replaceAll("__GAME_URL__", url.origin)
  .replaceAll("__PORTAL__", portal);
const out = join(root, "portal-build", portal);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.html"), html);
console.log(`wrote ${join(out, "index.html")} — zip the ${portal} folder and upload it`);

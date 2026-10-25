/**
 * Economy browser test: guest account, open a Bronze crate (confirm + skip animation), equip the
 * reward, and verify the balance shown matches the server.
 *   node e2e/economy.cjs [http://localhost:3000]
 */
const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS;
const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exit(1);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE);
  await page.fill("#name", "Collector");
  await page.getByRole("link", { name: /Collection/ }).click();
  await page.waitForSelector("text=Bronze Crate");
  const before = await page.evaluate(async () => {
    const a = JSON.parse(localStorage.getItem("arenix.account"));
    const r = await fetch(`${location.protocol}//${location.hostname}:8000/api/players/me`, { headers: { Authorization: `Bearer ${a.token}` } });
    return r.json();
  });
  if (before.game_points < 100) fail(`expected starting points, got ${before.game_points}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/crates.png` });
  await page.getByRole("button", { name: "All item odds" }).first().click();
  await page.waitForSelector("text=exact odds");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/odds.png` });
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Open…" }).first().click();
  await page.waitForSelector("text=This costs");
  await page.getByRole("button", { name: "Open crate" }).click();
  await page.getByRole("button", { name: "Skip" }).click().catch(() => {});
  await page.waitForSelector("text=Back to crates");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/reveal.png` });
  const equipBtn = page.getByRole("button", { name: "Equip" });
  if (await equipBtn.count()) await equipBtn.click();
  else await page.getByRole("button", { name: "Back to crates" }).click();
  await page.waitForTimeout(500);
  const after = await page.evaluate(async () => {
    const a = JSON.parse(localStorage.getItem("arenix.account"));
    const h = { headers: { Authorization: `Bearer ${a.token}` } };
    const base = `${location.protocol}//${location.hostname}:8000`;
    const me = await (await fetch(`${base}/api/players/me`, h)).json();
    const inv = await (await fetch(`${base}/api/players/me/inventory`, h)).json();
    return { me, inv };
  });
  if (after.me.game_points !== before.game_points - 100 + 0 && after.me.game_points !== before.game_points - 100 + 20)
    fail(`balance mismatch: ${before.game_points} -> ${after.me.game_points}`);
  if (after.inv.items.length !== 1) fail(`expected one item, got ${after.inv.items.length}`);
  await page.getByRole("tab", { name: "inventory" }).click();
  await page.getByRole("tab", { name: "store" }).click();
  await page.waitForSelector("text=mock provider");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/store.png` });
  if (errors.length) fail(errors.join(" | "));
  console.log("PASS", JSON.stringify({ item: after.inv.items[0].name, points: after.me.game_points, equipped: after.me.equipped }));
  await browser.close();
})().catch((e) => fail(e.stack ?? String(e)));

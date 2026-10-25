/**
 * End-to-end smoke test: a real browser plays a practice match against the running stack.
 * It walks to the forest, gathers 3 wood, delivers them to the watchtower, checks the score
 * and the client/server position agreement, then waits for a valid match result.
 *
 * Requires both servers running (see README) and Playwright with Chromium:
 *   node e2e/smoke.cjs [http://localhost:3000]
 */
const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exit(1);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/play?name=Smoke&archetype=knight&bots=2`);
  await page.waitForFunction(() => window.__ARENIX__?.client?.predictor, null, { timeout: 15000 });

  // In-page autopilot steering through the same channel as the on-screen touch controls.
  await page.evaluate(() => {
    window.__auto = (pts) =>
      new Promise((res) => {
        const a = window.__ARENIX__;
        const sc = a.game.scene.getScene("world");
        let i = 0;
        let best = Infinity;
        let lastProgress = performance.now();
        const tick = () => {
          const p = a.client.predictor;
          const [tx, ty] = pts[i];
          const dx = tx - p.x;
          const dy = ty - p.y;
          const d = Math.hypot(dx, dy);
          if (d < 0.12) {
            i++;
            best = Infinity;
            if (i >= pts.length) {
              sc.touch = { dx: 0, dy: 0, interact: false };
              return res({ ok: true });
            }
          }
          if (d < best - 0.05) {
            best = d;
            lastProgress = performance.now();
          }
          if (performance.now() - lastProgress > 3000) {
            sc.touch = { dx: 0, dy: 0, interact: false };
            return res({ ok: false, at: [p.x, p.y], waypoint: pts[i] });
          }
          const k = Math.min(1, d * 3) / (d || 1);
          sc.touch = { dx: Math.max(-1, Math.min(1, dx * k)), dy: Math.max(-1, Math.min(1, dy * k)), interact: false };
          requestAnimationFrame(tick);
        };
        tick();
      });
  });
  const route = async (pts) => {
    const r = await page.evaluate((p) => window.__auto(p), pts);
    if (!r.ok) fail(`route blocked ${JSON.stringify(r)}`);
  };
  const me = () =>
    page.evaluate(() => {
      const c = window.__ARENIX__.client;
      return c.snapshot.contestants.find((x) => x.id === c.you);
    });
  const prompt = () => page.evaluate(() => window.__ARENIX__.store.get().prompt);

  await route([[22.5, 23.5], [12.5, 23.5], [12.5, 13.5], [9.5, 13.5], [6.5, 13.5], [6.5, 14.5]]);
  if ((await prompt())?.targetId !== "wood_4") fail("no gather prompt at wood_4");
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("e");
    await page.waitForTimeout(700);
  }
  const carrying = (await me()).carrying;
  if (carrying.wood !== 3) fail(`expected 3 wood, got ${JSON.stringify(carrying)}`);

  await route([[6.5, 13.5], [12.5, 13.5], [12.5, 23.5], [23.5, 23.5], [23.5, 21], [25.5, 21], [25.5, 14.5], [31.5, 14.5], [31.5, 11.5]]);
  if ((await prompt())?.targetId !== "watchtower") fail("no deliver prompt at the watchtower");
  await page.keyboard.press("e");
  await page.waitForTimeout(800);
  const after = await me();
  if (after.score < 30) fail(`expected >= 30 points after delivery, got ${after.score}`);
  const sync = await page.evaluate(() => {
    const c = window.__ARENIX__.client;
    const s = c.snapshot.contestants.find((x) => x.id === c.you);
    return Math.hypot(c.predictor.x - s.x, c.predictor.y - s.y);
  });
  if (sync > 0.5) fail(`client prediction diverged from server by ${sync} tiles`);

  await page.waitForFunction(() => window.__ARENIX__.store.get().result, null, { timeout: 280000 });
  const result = await page.evaluate(() => window.__ARENIX__.store.get().result);
  if (!result.standings.some((s) => s.id === "p1" && s.contributed >= 3)) fail("player contribution missing from result");
  if (errors.length) fail(`browser errors: ${errors.join(" | ")}`);
  console.log("PASS", JSON.stringify(result));
  await browser.close();
})().catch((e) => fail(e.stack ?? String(e)));

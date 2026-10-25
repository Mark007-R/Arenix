/**
 * End-to-end smoke test: a real browser plays a practice match (impostor mode, Moonfall Isle).
 * It reads its secret role, walks (with a breadth-first route over the server's collision map)
 * to the nearest wood, gathers 3, delivers to the Watchtower — islanders score, impostors only
 * pretend — checks client/server position agreement, skips a council vote if still alive and
 * sends a chat line.
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
  await page.goto(`${BASE}/play?name=Smoke&archetype=knight&bots=4`);
  await page.waitForFunction(() => window.__ARENIX__?.client?.snapshot?.me?.role && window.__ARENIX__?.game?.scene?.getScene("world"), null, { timeout: 15000 });
  const role = await page.evaluate(() => window.__ARENIX__.client.snapshot.me.role);
  await page.mouse.click(640, 400); // dismiss the role card

  // In-page navigation: BFS over the collision grid, then steer through the same channel as the touch controls.
  await page.evaluate(() => {
    window.__goto = (goalFn) =>
      new Promise((res) => {
        const a = window.__ARENIX__;
        const c = a.client;
        const map = c.map;
        const solid = (x, y) => x < 0 || y < 0 || x >= map.width || y >= map.height || map.collision[y * map.width + x] === "1";
        const start = [Math.floor(c.predictor.x), Math.floor(c.predictor.y)];
        const key = (x, y) => y * map.width + x;
        const prev = new Map([[key(...start), null]]);
        const queue = [start];
        let end = null;
        while (queue.length) {
          const [x, y] = queue.shift();
          if (goalFn(x + 0.5, y + 0.5)) { end = [x, y]; break; }
          for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
            if (solid(nx, ny) || prev.has(key(nx, ny))) continue;
            prev.set(key(nx, ny), [x, y]);
            queue.push([nx, ny]);
          }
        }
        if (!end) return res({ ok: false, reason: "no path" });
        const pts = [];
        for (let p = end; p; p = prev.get(key(...p))) pts.unshift([p[0] + 0.5, p[1] + 0.5]);
        const sc = a.game.scene.getScene("world");
        let i = 0;
        let best = Infinity;
        let lastProgress = performance.now();
        const tick = () => {
          const p = c.predictor;
          if (c.snapshot.phase !== "explore" || c.snapshot.status !== "running") { sc.touch = { ...sc.touch, dx: 0, dy: 0 }; return res({ ok: false, reason: "interrupted" }); }
          const [tx, ty] = pts[i];
          const dx = tx - p.x;
          const dy = ty - p.y;
          const d = Math.hypot(dx, dy);
          if (d < 0.15) {
            i++;
            best = Infinity;
            if (i >= pts.length) { sc.touch = { ...sc.touch, dx: 0, dy: 0 }; return res({ ok: true }); }
          }
          if (d < best - 0.05) { best = d; lastProgress = performance.now(); }
          if (performance.now() - lastProgress > 3000) { sc.touch = { ...sc.touch, dx: 0, dy: 0 }; return res({ ok: false, reason: "stuck", at: [p.x, p.y] }); }
          const k = Math.min(1, d * 3) / (d || 1);
          sc.touch = { ...sc.touch, dx: Math.max(-1, Math.min(1, dx * k)), dy: Math.max(-1, Math.min(1, dy * k)) };
          requestAnimationFrame(tick);
        };
        tick();
      });
    window.__nearObject = (id, range) => {
      const o = window.__ARENIX__.client.map.objects.find((x) => x.id === id);
      return (x, y) => {
        const cx = Math.min(Math.max(x, o.x), o.x + o.w);
        const cy = Math.min(Math.max(y, o.y), o.y + o.h);
        return Math.hypot(x - cx, y - cy) <= range;
      };
    };
  });
  const goToObject = async (id) =>
    page.evaluate(([id]) => window.__goto(window.__nearObject(id, 1.1)), [id]);
  const me = () => page.evaluate(() => {
    const c = window.__ARENIX__.client;
    return c.snapshot.contestants.find((x) => x.id === c.you);
  });
  const prompt = () => page.evaluate(() => window.__ARENIX__.store.get().prompt);

  // Bots compete for wood (the tower and the beacons both need it): go to the nearest node that still has some.
  const nextWood = () => page.evaluate(() => {
    const c = window.__ARENIX__.client;
    const p = c.predictor;
    const nodes = c.map.objects.filter((o) => o.kind === "resource_node" && o.props.resource === "wood" && (c.snapshot.nodes[o.id] ?? 0) > 0);
    nodes.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    return nodes[0]?.id ?? null;
  });
  let gathered = false;
  for (let attempt = 0; attempt < 6 && !gathered; attempt++) {
    const node = await nextWood();
    if (!node) { await page.waitForTimeout(3000); continue; }
    const r = await goToObject(node);
    if (!r.ok) {
      if (r.reason === "interrupted") break;
      fail(`route to ${node} failed: ${JSON.stringify(r)}`);
    }
    if ((await prompt())?.targetId !== node) fail(`no gather prompt at ${node}`);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("e");
      await page.waitForTimeout(700);
    }
    gathered = ((await me())?.carrying.wood ?? 0) > 0;
  }
  const status = () => page.evaluate(() => ({ phase: window.__ARENIX__.client.snapshot.phase, status: window.__ARENIX__.client.snapshot.status, alive: window.__ARENIX__.client.snapshot.me.alive }));
  if (gathered) {
    const r = await goToObject("watchtower");
    if (r.ok) {
      if ((await prompt())?.targetId !== "watchtower") fail("no deliver prompt at the watchtower");
      const before = await page.evaluate(() => window.__ARENIX__.client.snapshot.mission.delivered.wood);
      await page.keyboard.press("e");
      await page.waitForTimeout(800);
      const after = await page.evaluate(() => window.__ARENIX__.client.snapshot.mission.delivered.wood);
      const feed = await page.evaluate(() => window.__ARENIX__.store.get().feed.map((f) => f.text).join(" | "));
      if (role === "islander" && !(after > before)) fail(`islander delivery not counted (${before} -> ${after})`);
      if (role === "impostor" && (after !== before || !feed.includes("pretended"))) fail(`impostor delivery should be fake: ${feed}`);
      const sync = await page.evaluate(() => {
        const c = window.__ARENIX__.client;
        const s = c.snapshot.contestants.find((x) => x.id === c.you);
        return Math.hypot(c.predictor.x - s.x, c.predictor.y - s.y);
      });
      if (sync > 0.5) fail(`client prediction diverged from server by ${sync} tiles`);
    }
  } else if ((await status()).alive) {
    fail("could not gather wood");
  }

  // Council: if still alive when voting opens, skip and see the reveal.
  await page.waitForFunction(
    () => ["vote"].includes(window.__ARENIX__.client.snapshot?.phase) || window.__ARENIX__.client.snapshot?.status !== "running",
    null,
    { timeout: 200000 },
  );
  const st = await status();
  let reveal = null;
  if (st.status === "running" && st.alive) {
    await page.getByRole("button", { name: "Skip vote" }).click();
    await page.waitForFunction(() => window.__ARENIX__.client.snapshot?.me?.vote === "skip", null, { timeout: 5000 });
    await page.waitForFunction(() => window.__ARENIX__.store.get().lastVote !== null, null, { timeout: 40000 });
    reveal = await page.evaluate(() => window.__ARENIX__.store.get().lastVote);
    if (reveal.votes.p1 !== "skip") fail(`player's skip not recorded: ${JSON.stringify(reveal)}`);
  }
  // Chat reaches the log (ghosts talk to ghosts, the living to everyone).
  if ((await status()).status === "running") {
    await page.evaluate(() => window.__ARENIX__.client.say({ text: "Anyone seen anything?" }));
    await page.waitForFunction(() => window.__ARENIX__.store.get().chat.some((c) => c.mine), null, { timeout: 5000 });
  }
  if (errors.length) fail(`browser errors: ${errors.join(" | ")}`);
  console.log("PASS", JSON.stringify({ role, gathered, reveal }));
  await browser.close();
})().catch((e) => fail(e.stack ?? String(e)));

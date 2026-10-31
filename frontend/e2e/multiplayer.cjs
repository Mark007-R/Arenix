/**
 * Two-player browser test against the running stack:
 * host creates a room, guest joins via invite link, both ready, host starts, they see each
 * other move, the guest reloads mid-match and resumes the same contestant.
 *   node e2e/multiplayer.cjs [http://localhost:3000]
 */
const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exit(1);
};
const log = (...a) => console.log("-", ...a);

async function contestants(page) {
  return page.evaluate(() => {
    const c = window.__ARENIX__?.client;
    return c?.snapshot
      ? {
          you: c.you,
          // Everyone in the match (contestants below only lists who this player can currently see).
          roster: c.snapshot.roster.map((x) => ({ id: x.id, bot: x.is_bot })),
          list: c.snapshot.contestants.map((x) => ({ id: x.id, x: x.x, y: x.y, bot: x.is_bot })),
        }
      : null;
  });
}

async function hold(page, dx, dy, ms) {
  await page.evaluate(([dx, dy]) => {
    const sc = window.__ARENIX__.game.scene.getScene("world");
    sc.touch = { dx, dy, interact: false };
  }, [dx, dy]);
  await page.waitForTimeout(ms);
  await page.evaluate(() => {
    window.__ARENIX__.game.scene.getScene("world").touch = { dx: 0, dy: 0, interact: false };
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("arenix.settings", JSON.stringify({ graphics: "low" }));
      localStorage.setItem("arenix.tutorial.seen", "1");
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    return page;
  };
  const host = await mk();
  const guest = await mk();

  await host.goto(BASE);
  await host.fill("#name", "Hosty");
  await host.getByRole("button", { name: "Create room" }).click();
  await host.waitForURL(/\/room\/?\?code=[A-Z0-9]{6}$/);
  const code = new URL(host.url()).searchParams.get("code");
  await host.waitForSelector('[data-testid="room-code"]');
  log("room", code);

  await guest.goto(`${BASE}/room?code=${code}`);
  await guest.fill("#name", "Guesty");
  await guest.getByRole("button", { name: "Join room" }).click();
  await guest.waitForSelector('[data-testid="room-code"]');
  await host.waitForFunction(() => document.body.innerText.includes("Guesty"));
  log("guest visible in host lobby");

  await host.getByRole("button", { name: /ready/ }).click();
  await guest.getByRole("button", { name: /ready/ }).click();
  await host.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Start match"));
    return b && !b.disabled;
  });
  await host.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/lobby.png` : "/dev/null" }).catch(() => {});
  await host.getByRole("button", { name: /Start match/ }).click();

  for (const p of [host, guest]) await p.waitForFunction(() => window.__ARENIX__?.game?.scene?.getScene("world") && window.__ARENIX__.client.snapshot?.status === "running");
  const h0 = await contestants(host);
  const g0 = await contestants(guest);
  if (h0.roster.length !== g0.roster.length) fail("rosters differ");
  if (h0.you === g0.you) fail("both players got the same contestant");
  const humans = h0.roster.filter((c) => !c.bot).map((c) => c.id).sort();
  if (humans.length !== 2) fail(`expected 2 humans, got ${humans}`);
  log("match running with", h0.roster.length, "contestants");

  const guestStart = h0.list.find((c) => c.id === g0.you);
  await hold(guest, 0, 1, 900);
  await host.waitForTimeout(400);
  const h1 = await contestants(host);
  const guestNow = h1.list.find((c) => c.id === g0.you);
  if (!(guestNow.y > guestStart.y + 1)) fail(`host did not see guest move (${guestStart.y} -> ${guestNow.y})`);
  log("host sees guest move", guestStart.y.toFixed(2), "->", guestNow.y.toFixed(2));
  if (process.env.SHOTS) await host.screenshot({ path: `${process.env.SHOTS}/mp-host.png` });

  // Reload the guest mid-match: same contestant, can keep moving (resume_seq).
  await guest.reload();
  await guest.waitForFunction(() => window.__ARENIX__?.game?.scene?.getScene("world") && window.__ARENIX__.client.snapshot?.status === "running");
  const g2 = await contestants(guest);
  if (g2.you !== g0.you) fail("guest got a different contestant after reload");
  const before = g2.list.find((c) => c.id === g2.you);
  await hold(guest, 1, 0, 700);
  await guest.waitForTimeout(400);
  const g3 = await contestants(guest);
  const after = g3.list.find((c) => c.id === g3.you);
  if (!(after.x > before.x + 0.5)) fail(`guest could not move after reload (${before.x} -> ${after.x})`);
  log("guest resumed after reload and moved", before.x.toFixed(2), "->", after.x.toFixed(2));

  if (errors.length) fail(`browser errors: ${errors.join(" | ")}`);
  console.log("PASS");
  await browser.close();
})().catch((e) => fail(e.stack ?? String(e)));

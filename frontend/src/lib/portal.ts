/**
 * Game-portal integration (CrazyGames, Poki, itch.io).
 *
 * On a portal the game runs inside the portal's launcher page (see frontend/portal/), which loads
 * the portal's SDK. The game tells the launcher when gameplay starts and stops and asks it for an
 * ad break between matches; the launcher answers when the break is over. Outside a portal every
 * call here does nothing.
 *
 * Portal rules also forbid outside payments and links, so donations and the diamond store hide
 * themselves when `onPortal()` is true.
 */

export type Portal = "crazygames" | "poki" | "itch";

const PORTALS: Portal[] = ["crazygames", "poki", "itch"];
const KEY = "arenix.portal";
const BREAK_TIMEOUT_MS = 45_000;

export function currentPortal(): Portal | null {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search).get("portal");
    if (q && (PORTALS as string[]).includes(q)) sessionStorage.setItem(KEY, q);
    const stored = sessionStorage.getItem(KEY);
    return stored && (PORTALS as string[]).includes(stored) ? (stored as Portal) : null;
  } catch {
    return null;
  }
}

export function onPortal(): boolean {
  return currentPortal() !== null;
}

function tell(type: string): void {
  if (!onPortal() || window.parent === window) return;
  window.parent.postMessage({ arenix: type }, "*");
}

let playing = false;

export function gameplayStart(): void {
  if (playing) return;
  playing = true;
  tell("gameplay_start");
}

export function gameplayStop(): void {
  if (!playing) return;
  playing = false;
  tell("gameplay_stop");
}

/** Ask the portal for an ad break; resolves when it is over (immediately when not on a portal). */
export function adBreak(): Promise<void> {
  if (!onPortal() || window.parent === window) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source === window.parent && (e.data as { arenix?: string })?.arenix === "break_done") done();
    };
    const timer = setTimeout(done, BREAK_TIMEOUT_MS); // never leave the player stuck
    window.addEventListener("message", onMessage);
    tell("break");
  });
}

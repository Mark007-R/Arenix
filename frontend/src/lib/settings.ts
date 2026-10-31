import { useSyncExternalStore } from "react";

/** Player settings, kept in this browser only. */

export interface Settings {
  music: number; // 0..1
  sfx: number; // 0..1
  bubbles: boolean; // chat bubbles above heads
  hideChat: boolean; // hide all chat from other players (safety)
  graphics: "auto" | "high" | "low"; // auto drops shadows and resolution when frames are slow
}

const KEY = "arenix.settings";
const DEFAULTS: Settings = { music: 0.5, sfx: 0.8, bubbles: true, hideChat: false, graphics: "auto" };
const listeners = new Set<(s: Settings) => void>();

export function loadSettings(): Settings {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: settings last for this page only */
  }
  listeners.forEach((l) => l(next));
  return next;
}

export function onSettings(l: (s: Settings) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const TUTORIAL_KEY = "arenix.tutorial.seen";

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === "1";
  } catch {
    return true;
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, "1");
  } catch {
    /* ignore */
  }
}


let cached: Settings | null = null;
function snapshot(): Settings {
  if (!cached) cached = loadSettings();
  return cached;
}
onSettings((s) => {
  cached = s;
});

/** React hook: current settings, re-rendering when they change. */
export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => onSettings(() => cb()),
    snapshot,
    () => DEFAULTS,
  );
}

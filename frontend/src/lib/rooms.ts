import { apiUrl } from "@/game/net/client";
import { loadAccount } from "./account";
import type { SeatGrant } from "@/shared/protocol";

const seatKey = (code: string) => `arenix.seat.${code.toUpperCase()}`;
export const PREFS_KEY = "arenix.prefs";

export interface Prefs {
  name: string;
  archetype: string;
  bots: number;
}

export function loadPrefs(): Prefs {
  const fallback = { name: "", archetype: "knight", bots: 2 };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

/** Seat credentials live in sessionStorage: they survive a reload but stay per-tab. */
export function loadSeat(code: string): SeatGrant | null {
  try {
    const raw = sessionStorage.getItem(seatKey(code));
    return raw ? (JSON.parse(raw) as SeatGrant) : null;
  } catch {
    return null;
  }
}

export function saveSeat(grant: SeatGrant): void {
  try {
    sessionStorage.setItem(seatKey(grant.code), JSON.stringify(grant));
  } catch {
    /* storage unavailable */
  }
}

export function forgetSeat(code: string): void {
  try {
    sessionStorage.removeItem(seatKey(code));
  } catch {
    /* storage unavailable */
  }
}

const MESSAGES: Record<string, string> = {
  not_found: "That room doesn't exist (check the code).",
  room_full: "That room is full.",
  in_progress: "That room's match has already started. Try again when it returns to the lobby.",
  already_joined: "You already have a seat in that room (open it from the tab you joined in).",
  rate_limited: "You're creating rooms too quickly. Wait a moment.",
  busy: "The server is busy. Try again shortly.",
};

export class RoomRequestError extends Error {}

async function post(path: string, body: unknown): Promise<SeatGrant> {
  let res: Response;
  const account = loadAccount();
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Optional: links the seat to your account for rewards and equipped cosmetics.
        ...(account ? { Authorization: `Bearer ${account.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new RoomRequestError("Could not reach the ARENIX server.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const code = data?.detail?.code as string | undefined;
    throw new RoomRequestError((code && MESSAGES[code]) || "Request rejected. Check your name and character.");
  }
  const grant = (await res.json()) as SeatGrant;
  saveSeat(grant);
  return grant;
}

export function createRoom(name: string, archetype: string, fillTo: number): Promise<SeatGrant> {
  return post("/api/rooms", { name, archetype, fill_to: fillTo });
}

export function joinRoom(code: string, name: string, archetype: string): Promise<SeatGrant> {
  return post(`/api/rooms/${encodeURIComponent(code.toUpperCase())}/join`, { name, archetype });
}

export function cleanName(name: string): string {
  return name.replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 20);
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

/** Guest account + authenticated API helper. The token is a bearer credential: keep it local. */
import { apiUrl } from "@/game/net/client";

const KEY = "arenix.account";

export interface Account {
  token: string;
  user_id: number;
  display_name: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function loadAccount(): Account | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

function saveAccount(a: Account | null): void {
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export async function api<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const account = loadAccount();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (account) headers.Authorization = `Bearer ${account.token}`;
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  } catch {
    throw new ApiError(0, "network", "Could not reach the ARENIX server.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const d = body?.detail ?? {};
    if (res.status === 401 && account) saveAccount(null); // stale token: start fresh next time
    throw new ApiError(res.status, d.code ?? "error", d.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Returns the stored account, creating a guest account if needed. Null if progression is disabled. */
export async function ensureAccount(displayName: string): Promise<Account | null> {
  const existing = loadAccount();
  if (existing) return existing;
  try {
    const a = await api<Account>("/api/auth/guest", {
      method: "POST",
      body: JSON.stringify({ display_name: displayName || "Adventurer" }),
    });
    saveAccount(a);
    return a;
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) return null; // server runs without a database
    throw e;
  }
}

export function newIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID()}`;
}

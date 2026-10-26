import { useSyncExternalStore } from "react";
import { apiUrl } from "@/game/net/client";

/** Server-side settings read at runtime (so changing a link needs no rebuild). */
export interface ClientConfig {
  payments: "stripe" | "mock" | "off";
  donate_url: string | null;
  contact_email: string | null;
}

const FALLBACK: ClientConfig = { payments: "off", donate_url: null, contact_email: null };
let current: ClientConfig = FALLBACK;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): void {
  if (loading || typeof window === "undefined") return;
  loading = fetch(`${apiUrl()}/api/config`)
    .then((r) => (r.ok ? (r.json() as Promise<ClientConfig>) : FALLBACK))
    .then((c) => {
      current = { ...FALLBACK, ...c };
      listeners.forEach((l) => l());
    })
    .catch(() => undefined);
}

export function useConfig(): ClientConfig {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      load();
      return () => listeners.delete(cb);
    },
    () => current,
    () => FALLBACK,
  );
}

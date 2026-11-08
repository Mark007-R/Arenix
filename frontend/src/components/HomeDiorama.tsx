"use client";

import { useEffect, useRef } from "react";
import type { Diorama } from "@/game/iso/diorama";

/** The animated island at the top of the home page; your chosen contestant waves in front. */
export function HomeDiorama({ archetype }: { archetype: string }) {
  const host = useRef<HTMLDivElement>(null);
  const diorama = useRef<Diorama | null>(null);
  // Latest pick, read when the island finishes loading (the saved pick can arrive before that).
  const latest = useRef(archetype);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void import("@/game/iso/diorama").then(({ createDiorama }) => {
      if (cancelled) return;
      try {
        diorama.current = createDiorama(el, latest.current, reduced);
      } catch {
        // No WebGL: the page still works, just without the island.
      }
    });
    return () => {
      cancelled = true;
      diorama.current?.destroy();
      diorama.current = null;
    };
  }, []);

  useEffect(() => {
    latest.current = archetype;
    diorama.current?.setHero(archetype);
  }, [archetype]);

  return <div ref={host} className="relative h-56 w-full sm:h-72" aria-hidden />;
}

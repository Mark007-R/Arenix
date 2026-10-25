"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";

const GameView = dynamic(() => import("@/components/GameView"), { ssr: false });

function Play() {
  const sp = useSearchParams();
  const params = useMemo(
    () => ({
      name: (sp.get("name") ?? "Player").slice(0, 20) || "Player",
      archetype: sp.get("archetype") ?? "knight",
      bots: Math.min(7, Math.max(0, Number(sp.get("bots") ?? 2) || 0)),
    }),
    [sp],
  );
  return <GameView params={params} />;
}

export default function PlayPage() {
  return (
    <Suspense fallback={null}>
      <Play />
    </Suspense>
  );
}

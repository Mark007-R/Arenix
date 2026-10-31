"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "@/game/net/client";

type Results = { conditions: Record<string, Record<string, unknown>>; seeds: number[]; contestants: number; time_limit_seconds: number };
interface Exp { id: number; name: string; status: string; progress: number; total: number; error: string | null; results?: Results | null }

const CONDITIONS = ["independent", "communicate", "negotiate", "negotiate_mem0", "negotiate_r1"] as const;
// Validated (dataviz validate_palette.js) against the panel surface #2a1f3d: lightness band + ≥3:1 contrast.
const BAR = "#b8892a";

const RATE_METRICS: [string, string][] = [
  ["shrine_success_rate", "Shrine awakened (needs 3 in sync)"],
  ["tower_completion_rate", "Watchtower repaired"],
  ["negotiation_success_rate", "Plans accepted"],
  ["invalid_action_rate", "Invalid-action rate"],
];
const TABLE_METRICS: [string, string, "pct" | "num"][] = [
  ["mission_completion_rate", "Mission completion (both)", "pct"],
  ["shrine_success_rate", "Shrine awakened", "pct"],
  ["tower_completion_rate", "Tower repaired", "pct"],
  ["negotiation_success_rate", "Negotiation success", "pct"],
  ["invalid_action_rate", "Invalid-action rate", "pct"],
  ["coordination_failures_per_match", "Coordination failures / match", "num"],
  ["eliminations_per_match", "Eliminations / match", "num"],
  ["alliances_per_match", "Alliances / match", "num"],
  ["messages_per_match", "Messages / match", "num"],
  ["decisions_per_match", "Strategist decisions / match", "num"],
  ["latency_ms_p50", "Latency p50 (ms)", "num"],
  ["latency_ms_p95", "Latency p95 (ms)", "num"],
  ["tokens_per_match", "Tokens / match", "num"],
  ["estimated_cost_usd_per_match", "Est. cost / match (USD)", "num"],
];

const fmt = (v: unknown, kind: "pct" | "num") =>
  v === null || v === undefined ? "—" : kind === "pct" ? `${(Number(v) * 100).toFixed(1)}%` : String(v);

/** One small multiple: a rate per condition as a labelled horizontal bar (0–100%, shared scale). */
function RateBars({ title, metric, results }: { title: string; metric: string; results: Results }) {
  const rows = Object.entries(results.conditions);
  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-sm font-bold text-parchment">{title}</figcaption>
      <ul className="space-y-1.5">
        {rows.map(([cond, r]) => {
          const v = r[metric] as number | null;
          return (
            <li key={cond} className="grid grid-cols-[120px_1fr_52px] items-center gap-2 text-xs" title={`${cond}: ${fmt(v, "pct")}`}>
              <span className="truncate text-parchment/80">{cond}</span>
              <span className="relative h-3 bg-well" aria-hidden>
                {v !== null && (
                  <span className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%`, background: BAR }} />
                )}
              </span>
              <span className="text-right tabular-nums text-parchment">{fmt(v, "pct")}</span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

export default function Experiments() {
  const [list, setList] = useState<Exp[]>([]);
  const [current, setCurrent] = useState<Exp | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set(["independent", "communicate", "negotiate"]));
  const [seeds, setSeeds] = useState("1-5");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await (await fetch(`${apiUrl()}/api/experiments`)).json();
      setList(d.experiments);
      const latest = d.experiments[0] as Exp | undefined;
      if (latest) setCurrent(await (await fetch(`${apiUrl()}/api/experiments/${latest.id}/results`)).json());
    } catch {
      setError("Could not reach the ARENIX server.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load once, then poll while running
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (current?.status !== "running") return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [current?.status, refresh]);

  async function start() {
    setError(null);
    const r = await fetch(`${apiUrl()}/api/experiments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "lab comparison", conditions: [...chosen], seeds }),
    });
    if (!r.ok) setError((await r.json()).detail?.message ?? "Could not start");
    await refresh();
  }

  const res = current?.results ?? null;
  return (
    <main className="min-h-dvh px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gold">Experiments</h1>
            <p className="text-sm text-parchment/70">Same seeds, different agent conditions. Every number comes from an actual run on this server.</p>
          </div>
          <Link className="btn btn-ghost" href="/lab">Agent Lab</Link>
        </header>

        <section className="panel mb-4 p-4">
          <h2 className="mb-2 font-bold text-gold">Run a comparison</h2>
          <div className="flex flex-wrap gap-3 text-sm">
            {CONDITIONS.map((c) => (
              <label key={c} className="flex items-center gap-1">
                <input type="checkbox" checked={chosen.has(c)} onChange={() => {
                  const n = new Set(chosen);
                  if (n.has(c)) n.delete(c); else n.add(c);
                  setChosen(n);
                }} />
                {c}
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 text-sm">
            <label>Seeds <input value={seeds} onChange={(e) => setSeeds(e.target.value)} className="w-20 border-2 border-ink bg-well px-1" aria-label="Seeds" /></label>
            <button className="btn text-sm" onClick={start} disabled={current?.status === "running" || chosen.size === 0}>Run</button>
            {current?.status === "running" && <span className="text-gold">Running… {current.progress}/{current.total} matches</span>}
          </div>
          <p className="mt-2 text-xs text-parchment/50">The LLM condition is only available via the CLI runner, because it costs money. See docs/benchmarks.</p>
          {error && <p className="mt-2 text-ember">{error}</p>}
        </section>

        {current?.status === "failed" && <p className="panel mb-4 p-3 text-ember">Experiment failed: {current.error}</p>}
        {res && (
          <>
            <section className="panel mb-4 p-4">
              <h2 className="mb-1 font-bold text-gold">Results · experiment #{current?.id}</h2>
              <p className="mb-3 text-xs text-parchment/60">
                {res.seeds.length} seeds per condition ({res.seeds[0]}–{res.seeds[res.seeds.length - 1]}), {res.contestants} AI contestants, {res.time_limit_seconds} s matches. Small samples: differences of a few points are noise.
              </p>
              <div className="grid gap-5 md:grid-cols-2">
                {RATE_METRICS.map(([k, label]) => <RateBars key={k} title={label} metric={k} results={res} />)}
              </div>
            </section>
            <section className="panel overflow-x-auto p-4">
              <h2 className="mb-2 font-bold text-gold">All metrics</h2>
              <table className="w-full text-left text-sm">
                <thead className="text-gold"><tr><th className="py-1">Metric</th>{Object.keys(res.conditions).map((c) => <th key={c} className="text-right">{c}</th>)}</tr></thead>
                <tbody>
                  {TABLE_METRICS.map(([k, label, kind]) => (
                    <tr key={k} className="border-t border-dusk">
                      <td className="py-1">{label}</td>
                      {Object.values(res.conditions).map((r, i) => <td key={i} className="text-right tabular-nums">{fmt(r[k], kind)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
        {list.length > 1 && <p className="mt-3 text-xs text-parchment/50">{list.length} experiments this server session.</p>}
      </div>
    </main>
  );
}

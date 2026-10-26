"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { DecisionInspector } from "@/components/lab/DecisionInspector";
import { InteractionGraph } from "@/components/lab/InteractionGraph";
import { ReplayMap } from "@/components/lab/ReplayMap";
import { EDGE_STYLE, type LabPayload } from "@/components/lab/types";
import { apiUrl } from "@/game/net/client";
import { replayTo } from "@/lib/replay";

const HIDDEN_BY_DEFAULT = new Set(["position_sample", "resource_regenerated", "resource_gathered", "vote_cast"]);

function describe(t: string, d: Record<string, unknown>, name: (id: unknown) => string): string {
  switch (t) {
    case "chat": return `${name(d.sender)}${d.to ? ` → ${name(d.to)}` : ""}${d.kind ? ` [${String(d.kind)}]` : ""}: ${String(d.text)}`;
    case "resources_delivered": return `${name(d.contestant)} delivered ${JSON.stringify(d.accepted)}`;
    case "alliance_proposed": return `${name(d.proposer)} offered ${name(d.target)} an alliance`;
    case "alliance_formed": return `alliance: ${(d.members as string[]).map(name).join(" & ")}`;
    case "alliance_rejected": return `${name(d.target)} rejected ${name(d.proposer)}`;
    case "alliance_broken": return `${name(d.by)} broke with ${name(d.partner)} (${String(d.reason)})`;
    case "vote_resolved": return `votes: ${Object.entries(d.votes as Record<string, string>).map(([v, t2]) => `${name(v)}→${t2 === "skip" ? "skip" : name(t2)}`).join(", ")} · out: ${d.eliminated ? name(d.eliminated) : "nobody"}`;
    case "contestant_eliminated": return `${name(d.contestant)} eliminated`;
    case "shrine_channel": return `${name(d.contestant)} channels (${String(d.count)}/${String(d.required)})`;
    case "shrine_activated": return `shrine awakened by ${(d.participants as string[]).map(name).join(", ")}`;
    case "meeting_called": return `council meeting ${String(d.meeting)} (${String(d.cause)})`;
    case "objective_assigned": return `${name(d.contestant)}'s secret objective: ${(d.objective as { text: string }).text}`;
    case "match_finished": return `match over (${String(d.reason)}), winner ${name(d.winner)}`;
    default: return t.replace(/_/g, " ");
  }
}

export default function LabMatchPage() {
  // useSearchParams needs a Suspense boundary in a statically exported page.
  return (
    <Suspense fallback={null}>
      <LabMatch />
    </Suspense>
  );
}

function LabMatch() {
  const id = useSearchParams().get("id") ?? "";
  const [data, setData] = useState<LabPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [edgeTypes, setEdgeTypes] = useState<Set<string>>(new Set(Object.keys(EDGE_STYLE)));
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState("all");

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${apiUrl()}/api/agent-lab/matches/${encodeURIComponent(id)}`)
        .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).detail?.message ?? "not found"))))
        .then((d: LabPayload) => {
          if (!alive) return;
          setData(d);
          setCursor((c) => (c === 0 ? d.events.length - 1 : c));
        })
        .catch((e) => alive && setError(String(e.message ?? e)));
    void load();
    const t = setInterval(() => data?.status === "running" && load(), 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, data?.status]);

  useEffect(() => {
    if (!playing || !data) return;
    const t = setInterval(() => setCursor((c) => {
      if (c >= data.events.length - 1) {
        setPlaying(false);
        return c;
      }
      return c + 1;
    }), 120);
    return () => clearInterval(t);
  }, [playing, data]);

  const names = useMemo(() => Object.fromEntries((data?.contestants ?? []).map((c) => [c.id, c.name])), [data]);
  const name = (x: unknown) => names[String(x)] ?? String(x);
  const seq = data?.events[cursor]?.seq ?? 0;
  const state = useMemo(() => (data ? replayTo(data.events, seq) : null), [data, seq]);
  const phases = useMemo(() => [...new Set((data?.events ?? []).map((e) => e.phase_id))], [data]);
  const types = useMemo(() => [...new Set((data?.events ?? []).map((e) => e.type))].sort(), [data]);

  if (error) return <main className="p-6"><p className="panel p-4 text-ember">{error}</p><Link className="btn mt-4" href="/lab">Back</Link></main>;
  if (!data || !state) return <main className="p-6">Loading…</main>;

  const timeline = data.events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => (typeFilter === "all" ? !HIDDEN_BY_DEFAULT.has(e.type) : e.type === typeFilter))
    .filter(({ e }) => phaseFilter === "all" || e.phase_id === phaseFilter)
    .filter(({ e }) => !selected || JSON.stringify(e.data).includes(`"${selected}"`));
  const decisions = data.decisions.filter((d) => !selected || d.agent === selected);
  const summary = data.agent_summary as Record<string, unknown> | null;

  return (
    <main className="min-h-dvh px-3 py-4">
      <div className="mx-auto max-w-7xl">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-gold">Agent Lab · {data.match_id}</h1>
            <p className="text-xs text-parchment/70">seed {data.seed} · map {data.map_id} · {Math.round(data.ticks / 20)} s · {data.status}</p>
          </div>
          <Link className="btn btn-ghost" href="/lab">All matches</Link>
        </header>
        {data.visibility_note && <p className="panel mb-3 p-2 text-sm text-gold">{data.visibility_note}</p>}
        {summary && (
          <section className="panel mb-3 grid grid-cols-2 gap-2 p-3 text-xs sm:grid-cols-4 lg:grid-cols-8" aria-label="Agent metrics">
            {[
              ["strategist", `${summary.provider}${summary.is_llm ? ` (${summary.model})` : " (not an LLM)"}`],
              ["decisions", summary.decisions],
              ["actions proposed", summary.actions_proposed],
              ["rejected (pre-check)", summary.actions_rejected_prevalidation],
              ["rejected (server)", summary.actions_rejected_engine],
              ["latency p50 / p95", `${Math.round(Number(summary.latency_ms_p50 ?? 0))} / ${Math.round(Number(summary.latency_ms_p95 ?? 0))} ms`],
              ["tokens in / out", `${summary.input_tokens} / ${summary.output_tokens}`],
              ["est. cost", `$${Number(summary.estimated_cost_usd ?? 0).toFixed(4)}`],
            ].map(([k, v]) => (
              <div key={String(k)}><div className="text-parchment/60">{String(k)}</div><div className="font-bold">{String(v)}</div></div>
            ))}
          </section>
        )}

        <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
          <section className="panel p-3">
            <h2 className="mb-1 font-bold text-gold">Interaction graph</h2>
            <div className="mb-2 flex flex-wrap gap-2 text-xs">
              {Object.entries(EDGE_STYLE).map(([t, st]) => (
                <label key={t} className="flex items-center gap-1">
                  <input type="checkbox" checked={edgeTypes.has(t)} onChange={() => {
                    const n = new Set(edgeTypes);
                    if (n.has(t)) n.delete(t); else n.add(t);
                    setEdgeTypes(n);
                  }} />
                  <span style={{ color: st.color }}>{st.label}</span>
                </label>
              ))}
            </div>
            <InteractionGraph contestants={data.contestants} edges={data.graph.edges} enabled={edgeTypes}
              selected={selected} onSelect={setSelected} upToSeq={seq} />
            {selected && (() => {
              const c = data.contestants.find((x) => x.id === selected)!;
              return (
                <div className="mt-2 border-t-2 border-dusk pt-2 text-sm">
                  <b>{c.name}</b> ({c.id}{c.is_bot ? ", AI" : ""}) · score {state.scores[c.id] ?? 0} · {state.alive[c.id] ? "alive" : "eliminated"}
                  {state.alliances[c.id] && <> · allied with {name(state.alliances[c.id])}</>}
                  {c.objective && <div className="text-xs text-parchment/70">Secret objective: {c.objective.text}</div>}
                </div>
              );
            })()}
          </section>

          <section className="panel p-3">
            <h2 className="mb-1 font-bold text-gold">Replay</h2>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <button className="btn px-2 py-1 text-xs" onClick={() => setCursor(0)}>⏮</button>
              <button className="btn px-2 py-1 text-xs" onClick={() => setCursor((c) => Math.max(0, c - 1))}>◀</button>
              <button className="btn px-3 py-1 text-xs" onClick={() => { if (cursor >= data.events.length - 1) setCursor(0); setPlaying((p) => !p); }}>{playing ? "Pause" : "Play"}</button>
              <button className="btn px-2 py-1 text-xs" onClick={() => setCursor((c) => Math.min(data.events.length - 1, c + 1))}>▶</button>
              <button className="btn px-2 py-1 text-xs" onClick={() => setCursor(data.events.length - 1)}>⏭</button>
              <input type="range" min={0} max={data.events.length - 1} value={cursor} onChange={(e) => setCursor(Number(e.target.value))}
                className="flex-1 accent-[#f4c542]" aria-label="Replay position" />
              <span className="tabular-nums text-xs">t{state.tick} · #{seq}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
              <ReplayMap mapId={data.map_id} positions={state.positions} highlight={selected} />
              <div className="text-xs">
                <div>Phase: <b>{state.phase}</b> (meeting {state.meeting})</div>
                <div>Tower: {state.tower_repaired ? "repaired ✔" : `${state.delivered.wood ?? 0}/${state.required.wood ?? 0} wood, ${state.delivered.stone ?? 0}/${state.required.stone ?? 0} stone`}</div>
                <div>Shrine: {state.shrine}</div>
                <ul className="mt-2 space-y-0.5">
                  {[...state.contestants].sort((a, b) => (state.scores[b] ?? 0) - (state.scores[a] ?? 0)).map((cid) => (
                    <li key={cid} className={state.alive[cid] ? "" : "line-through opacity-50"}>
                      {name(cid)} <span className="float-right tabular-nums">{state.scores[cid] ?? 0}</span>
                      {state.alliances[cid] && <span title={`allied with ${name(state.alliances[cid])}`}> 🤝</span>}
                    </li>
                  ))}
                </ul>
                {state.finished && <div className="mt-2 text-leaf">Winner: {name(state.winner)}</div>}
              </div>
            </div>
            <p className="mt-1 text-[11px] text-parchment/50">Reconstructed from the event log only — no simulation or model calls are re-run.</p>
          </section>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr]">
          <section className="panel p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="font-bold text-gold">Event timeline</h2>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-[#120c1c] text-xs" aria-label="Event type">
                <option value="all">key events</option>
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)} className="bg-[#120c1c] text-xs" aria-label="Phase">
                <option value="all">all phases</option>
                {phases.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {selected && <button className="text-xs underline" onClick={() => setSelected(null)}>clear {selected}</button>}
            </div>
            <ol className="max-h-[480px] space-y-0.5 overflow-y-auto text-xs">
              {timeline.map(({ e, i }) => (
                <li key={e.seq}>
                  <button className={`w-full text-left ${i === cursor ? "bg-dusk" : ""} ${i > cursor ? "opacity-40" : ""}`} onClick={() => setCursor(i)}>
                    <span className="tabular-nums text-parchment/50">t{e.tick}</span>{" "}
                    {e.private && <span title={`visible to ${e.visible_to?.join(", ") || "nobody (replay only)"}`}>🔒</span>}{" "}
                    {describe(e.type, e.data, name)}
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <section className="panel p-3">
            <h2 className="mb-1 font-bold text-gold">Decision inspector {selected && `· ${name(selected)}`}</h2>
            {!data.full_record ? (
              <p className="text-sm text-parchment/70">Decisions are revealed when the match ends.</p>
            ) : decisions.length === 0 ? (
              <p className="text-sm text-parchment/70">No strategist decisions recorded (rule-based AI, or no AI seats).</p>
            ) : (
              <div className="max-h-[480px] space-y-2 overflow-y-auto">
                {decisions.slice(0, 200).map((d) => <DecisionInspector key={d.id} d={d} note={data.decisions_note} />)}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

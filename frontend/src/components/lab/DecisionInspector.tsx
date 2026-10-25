"use client";

import { useState } from "react";
import type { LabDecision } from "./types";

function Json({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-[#120c1c] p-2 text-[11px] leading-snug">{JSON.stringify(value, null, 2)}</pre>;
}

/** One decision: authorised input → generated proposal → validation → authoritative outcome. */
export function DecisionInspector({ d, note }: { d: LabDecision; note: string }) {
  const [open, setOpen] = useState(false);
  const ctx = d.context ?? {};
  return (
    <article className="border-[3px] border-ink bg-[#120c1c]/70 p-2 text-sm">
      <button className="flex w-full items-baseline justify-between gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>
          <b className="text-gold">#{d.id}</b> t{d.tick_requested} · <span className="text-sky">{d.trigger}</span> · {d.phase_id}
        </span>
        <span className={d.status === "applied" ? "text-leaf" : d.status === "stale" ? "text-gold" : "text-ember"}>{d.status}</span>
      </button>
      {d.decision && <p className="mt-1 text-parchment/90">“{d.decision.summary}” <span className="text-xs text-parchment/50">(generated)</span></p>}
      {d.error && <p className="mt-1 text-ember">Error: {d.error} — fallback policy covered this decision.</p>}
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-parchment/60">{note}</p>
          <section>
            <h4 className="text-xs uppercase tracking-wider text-gold">1 · Authorised observation (input)</h4>
            <details><summary className="cursor-pointer text-xs">Facts the agent knew ({(ctx.facts as unknown[] | undefined)?.length ?? 0})</summary><Json value={ctx.facts} /></details>
            <details><summary className="cursor-pointer text-xs">Messages from others — untrusted claims ({(ctx.messages_from_others as unknown[] | undefined)?.length ?? 0})</summary><Json value={ctx.messages_from_others} /></details>
            <details><summary className="cursor-pointer text-xs">Self, contestants, beliefs</summary><Json value={{ you: ctx.you, contestants: ctx.contestants, open_threads: ctx.open_threads }} /></details>
            <details><summary className="cursor-pointer text-xs">Legal actions offered</summary><Json value={ctx.legal_actions} /></details>
          </section>
          <section>
            <h4 className="text-xs uppercase tracking-wider text-gold">2 · Proposed decision (generated)</h4>
            <Json value={d.decision} />
          </section>
          <section>
            <h4 className="text-xs uppercase tracking-wider text-gold">3 · Validation</h4>
            <ul className="text-xs">
              {d.actions.map((a, i) => (
                <li key={i} className={a.prevalidated ? "text-leaf" : "text-ember"}>
                  {a.prevalidated ? "✔" : "✘"} {String(a.proposed.kind)} {a.proposed.msg_type ? `(${String(a.proposed.msg_type)})` : ""}
                  {a.reason && ` — ${a.reason}`}
                </li>
              ))}
              {d.actions.length === 0 && <li className="text-parchment/60">No social actions (goal only: {d.decision?.goal ?? "—"}).</li>}
            </ul>
          </section>
          <section>
            <h4 className="text-xs uppercase tracking-wider text-gold">4 · Confirmed outcome (server)</h4>
            <ul className="text-xs">
              {d.engine_results.map((r, i) => (
                <li key={i} className={r.ok ? "text-leaf" : "text-ember"}>
                  t{r.tick} {r.ok ? "accepted" : `refused (${r.reason})`}: {JSON.stringify(r.action)}
                </li>
              ))}
              {d.engine_results.length === 0 && <li className="text-parchment/60">Nothing reached the engine.</li>}
            </ul>
          </section>
          <p className="text-xs text-parchment/60">
            {d.provider}{d.is_llm ? ` · ${d.model}` : " (not an LLM)"} · {d.latency_ms} ms · {d.input_tokens}+{d.output_tokens} tokens
            {d.cost_usd ? ` · ~$${d.cost_usd.toFixed(4)} (estimated)` : ""}
          </p>
        </div>
      )}
    </article>
  );
}

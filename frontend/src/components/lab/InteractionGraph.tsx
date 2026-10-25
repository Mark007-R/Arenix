"use client";

import { EDGE_STYLE, type LabContestant, type LabEdge } from "./types";

/** Contestants on a circle; interactions as curved directed edges, width by count. */
export function InteractionGraph({ contestants, edges, enabled, selected, onSelect, upToSeq }: {
  contestants: LabContestant[];
  edges: LabEdge[];
  enabled: Set<string>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  upToSeq: number;
}) {
  const size = 420;
  const r = 150;
  const c = size / 2;
  const pos = Object.fromEntries(
    contestants.map((k, i) => {
      const a = (i / contestants.length) * Math.PI * 2 - Math.PI / 2;
      return [k.id, { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r }];
    }),
  );
  const shown = edges
    .filter((e) => enabled.has(e.type))
    .map((e) => ({ ...e, count: e.seqs.filter((s) => s <= upToSeq).length }))
    .filter((e) => e.count > 0 && pos[e.source] && pos[e.target]);
  const types = Object.keys(EDGE_STYLE);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full" role="img" aria-label="Interaction graph">
      <defs>
        {types.map((t) => (
          <marker key={t} id={`arrow-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={EDGE_STYLE[t]!.color} />
          </marker>
        ))}
      </defs>
      {shown.map((e) => {
        const a = pos[e.source]!;
        const b = pos[e.target]!;
        const k = types.indexOf(e.type) - 3;
        // Offset each edge type so parallel edges between the same pair don't overlap.
        const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08 * k;
        const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.08 * k;
        const dim = selected && e.source !== selected && e.target !== selected;
        const st = EDGE_STYLE[e.type]!;
        return (
          <path key={`${e.type}-${e.source}-${e.target}`} d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`}
            fill="none" stroke={st.color} strokeWidth={Math.min(6, 1 + e.count)} strokeDasharray={st.dash}
            opacity={dim ? 0.12 : 0.85} markerEnd={`url(#arrow-${e.type})`}>
            <title>{`${st.label}: ${e.source} → ${e.target} ×${e.count}`}</title>
          </path>
        );
      })}
      {contestants.map((k) => {
        const p = pos[k.id]!;
        const isSel = selected === k.id;
        return (
          <g key={k.id} transform={`translate(${p.x},${p.y})`} onClick={() => onSelect(isSel ? null : k.id)}
            className="cursor-pointer" role="button" aria-label={`Inspect ${k.name}`}>
            <circle r={isSel ? 24 : 20} fill={k.alive ? "#2a1f3d" : "#120c1c"} stroke={isSel ? "#f4c542" : k.is_bot ? "#6aa8ee" : "#ffe066"} strokeWidth={3} />
            <text textAnchor="middle" dy="4" fontSize="11" fill="#fbf7ee" fontFamily="Pixelify Sans, monospace">{k.id}</text>
            <text textAnchor="middle" dy="38" fontSize="11" fill={k.alive ? "#fbf7ee" : "#888"} fontFamily="Pixelify Sans, monospace">
              {k.name}{k.alive ? "" : " 💀"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

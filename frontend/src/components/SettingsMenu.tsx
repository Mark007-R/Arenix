"use client";

import { useState } from "react";
import { audio } from "@/lib/audio";
import { saveSettings, useSettings } from "@/lib/settings";
import { HowToPlay } from "./HowToPlay";

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-sm">
      <span className="flex justify-between"><span>{label}</span><span className="tabular-nums text-parchment/60">{Math.round(value * 100)}%</span></span>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#4b5734]" />
    </label>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="mt-1 accent-[#4b5734]" />
      <span>
        {label}
        {hint && <span className="block text-xs text-parchment/55">{hint}</span>}
      </span>
    </label>
  );
}

/** Gear button + settings dialog (volumes, chat safety, motion, controls, how to play). */
export function SettingsMenu({ reducedMotion, onToggleMotion, className = "" }: {
  reducedMotion?: boolean;
  onToggleMotion?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const s = useSettings();
  return (
    <>
      <button className={`btn btn-ghost px-2 py-1 text-sm ${className}`} onClick={() => setOpen(true)} aria-label="Settings" title="Settings">
        ⚙️
      </button>
      {open && (
        <div className="pop-in fixed inset-0 z-50 flex items-center justify-center bg-well/70 p-4" role="dialog" aria-label="Settings"
          onClick={() => setOpen(false)}>
          <div className="panel w-full max-w-md space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gold">Settings</h2>
              <button className="btn btn-ghost px-2 py-1" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <section className="space-y-3">
              <h3 className="text-xs uppercase tracking-wider text-gold">Sound</h3>
              <Slider label="Music" value={s.music} onChange={(v) => saveSettings({ music: v })} />
              <Slider label="Sound effects" value={s.sfx} onChange={(v) => { saveSettings({ sfx: v }); audio().play("click"); }} />
            </section>
            <section className="space-y-3">
              <h3 className="text-xs uppercase tracking-wider text-gold">Chat &amp; safety</h3>
              <Toggle label="Speech bubbles above players" value={s.bubbles} onChange={(v) => saveSettings({ bubbles: v })} />
              <Toggle label="Hide chat from other players" hint="You can still play and vote. Mute or report individual players from the player list."
                value={s.hideChat} onChange={(v) => saveSettings({ hideChat: v })} />
            </section>
            <section className="space-y-3">
              <h3 className="text-xs uppercase tracking-wider text-gold">Display</h3>
              <label className="block text-sm">
                <span className="mb-1 block">Graphics</span>
                <select
                  value={s.graphics}
                  onChange={(e) => saveSettings({ graphics: e.target.value as "auto" | "high" | "low" })}
                  className="w-full border-[1.5px] border-ink bg-well px-2 py-1"
                >
                  <option value="auto">Auto (lower quality if the game runs slowly)</option>
                  <option value="high">High (shadows, sharp)</option>
                  <option value="low">Low (faster on older devices)</option>
                </select>
              </label>
              {onToggleMotion && (
                <Toggle label="Reduced motion" hint="Fewer animations and no screen shake." value={!!reducedMotion} onChange={onToggleMotion} />
              )}
            </section>
            <section className="text-xs leading-relaxed text-parchment/75">
              <h3 className="mb-1 uppercase tracking-wider text-gold">Controls</h3>
              <p>WASD / arrows move · E or Space interact / report · K eliminate (impostor) · Enter chat · Q quick-chat · Esc leave chat</p>
            </section>
            <button className="btn w-full" onClick={() => setHelp(true)}>📖 How to play</button>
          </div>
        </div>
      )}
      {help && <HowToPlay onClose={() => setHelp(false)} />}
    </>
  );
}

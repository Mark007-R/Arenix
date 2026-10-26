"use client";

import { useEffect, useRef, useState } from "react";
import type { GameClient } from "@/game/net/client";
import { useHud, type HudStore } from "@/lib/store";
import { QUICK_CHAT } from "@/shared/protocol";
import { useSettings } from "@/lib/settings";

const KIND_LABEL: Record<string, string> = {
  PLAN_PROPOSAL: "plan",
  ALLIANCE_PROPOSAL: "alliance",
  ACCEPT: "accept",
  COUNTER_OFFER: "counter",
  REJECT: "reject",
  INFORMATION_SHARE: "info",
  ACTION_PROPOSAL: "action",
  VOTE_INTENT: "vote intent",
};

/** Public chat + ally whispers. Enter focuses the input, Esc leaves it, Q opens quick-chat. */
export function ChatPanel({ client, store }: { client: GameClient; store: HudStore }) {
  const allChat = useHud(store, (s) => s.chat);
  const muted = useHud(store, (s) => s.muted);
  const hideChat = useSettings().hideChat;
  const chat = allChat.filter((c) => !muted.includes(c.sender) && (!hideChat || c.mine));
  const ally = useHud(store, (s) => s.snapshot?.me?.ally ?? null);
  const alive = useHud(store, (s) => s.snapshot?.roster.find((r) => r.id === s.you)?.alive ?? true);
  const ghost = useHud(store, (s) => s.snapshot?.mode === "impostor" && s.snapshot.me?.alive === false);
  const unlocked = useHud(store, (s) => s.snapshot?.me?.phrases);
  const [text, setText] = useState("");
  const [whisper, setWhisper] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [chat]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return;
      if (e.key === "Enter") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "q" || e.key === "Q") {
        setQuickOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const to = whisper && ally ? ally : null;
  function send() {
    const t = text.trim();
    if (t) client.say({ text: t }, to);
    setText("");
    inputRef.current?.blur();
  }

  return (
    <div className="pointer-events-auto w-80 max-w-[90vw]">
      <ul ref={logRef} className="mb-1 max-h-36 space-y-0.5 overflow-y-auto text-sm drop-shadow-[0_2px_0_#120c1c]" aria-live="polite" aria-label="Chat">
        {chat.map((c) => (
          <li key={c.id} className={c.ghost ? "text-[#b9a7d8] italic" : c.private ? "text-[#d8c2ff]" : c.mine ? "text-[#ffe066]" : "text-parchment"}>
            {c.ghost && "👻 "}
            {c.kind && <span className="mr-1 bg-dusk px-1 text-[10px] uppercase text-sky" title={c.kind}>{KIND_LABEL[c.kind] ?? c.kind}</span>}
            <b>{c.mine ? "You" : c.senderName}</b>
            {c.private && <span className="text-xs"> (whisper{c.mine ? ` to ${client.name(c.to)}` : ""})</span>}: {c.text}
          </li>
        ))}
      </ul>
      {quickOpen && alive && !ghost && (
        <div className="panel mb-1 grid max-h-48 grid-cols-2 gap-1 overflow-y-auto p-1 text-xs">
          {Object.entries({ ...QUICK_CHAT, ...(unlocked ?? {}) }).map(([id, phrase]) => (
            <button key={id} className="border-2 border-ink bg-[#120c1c] px-1 py-1 text-left hover:border-gold"
              onClick={() => { client.say({ quick: id }, to); setQuickOpen(false); }}>
              {phrase}
            </button>
          ))}
        </div>
      )}
      {alive || ghost ? (
        <div className="flex gap-1">
          <input
            ref={inputRef}
            value={text}
            maxLength={140}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => store.set({ typing: true })}
            onBlur={() => store.set({ typing: false })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") send();
              if (e.key === "Escape") inputRef.current?.blur();
            }}
            placeholder={ghost ? "Ghost chat — only the dead hear you" : to ? `Whisper to ${client.name(ally)}…` : "Press Enter to chat"}
            aria-label="Chat message"
            className={`min-w-0 flex-1 border-[3px] border-ink px-2 py-1 text-sm outline-none focus:border-sky ${to ? "bg-[#43305c]" : "bg-[#120c1c]/90"}`}
          />
          {!ghost && (
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setQuickOpen((v) => !v)} title="Quick chat (Q)">💬</button>
          )}
          {ally && (
            <button className={`btn px-2 py-1 text-xs ${whisper ? "" : "btn-ghost"}`} onClick={() => setWhisper((v) => !v)}
              title="Whisper to your ally" aria-pressed={whisper}>🤫</button>
          )}
        </div>
      ) : (
        <p className="text-xs text-parchment/60">Voted out — spectating. Your voice no longer counts.</p>
      )}
    </div>
  );
}

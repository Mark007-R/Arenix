"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Portrait } from "@/components/Portrait";
import { OpeningModal, type OpeningResult } from "@/components/economy/OpeningModal";
import {
  CURRENCY_ICON,
  CURRENCY_LABEL,
  RARITY_COLOR,
  pct,
  previewCosmetics,
  type CrateDTO,
  type ItemDTO,
  type Profile,
} from "@/components/economy/types";
import type { Cosmetics } from "@/game/archetypes";
import { ApiError, api, ensureAccount, newIdempotencyKey } from "@/lib/account";
import { onPortal } from "@/lib/portal";
import { loadPrefs } from "@/lib/rooms";
import { loadReducedMotion } from "@/lib/useGameClient";

type Tab = "crates" | "inventory" | "store" | "history";
interface Pack { id: string; label: string; diamonds: number; price_usd_cents: number }
interface StoreInfo { provider: "stripe" | "mock" | "off"; notice: string; packs: Pack[] }
interface Tx { id: number; currency: "game_points" | "diamonds"; amount: number; balance_after: number; reason: string; created_at: string }

const SLOT_FOR: Record<string, string | undefined> = { skin: "skin", hat: "hat", effect: "effect" };

export default function CollectionPage() {
  const [tab, setTab] = useState<Tab>("crates");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [crates, setCrates] = useState<CrateDTO[]>([]);
  const [items, setItems] = useState<ItemDTO[]>([]);
  const [packs, setPacks] = useState<StoreInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [portal, setPortal] = useState(false);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [odds, setOdds] = useState<CrateDTO | null>(null);
  const [confirmCrate, setConfirmCrate] = useState<CrateDTO | null>(null);
  const [confirmPack, setConfirmPack] = useState<Pack | null>(null);
  const [opening, setOpening] = useState<OpeningResult | null>(null);
  const [busy, setBusy] = useState(false);
  const archetype = typeof window === "undefined" ? "knight" : loadPrefs().archetype || "knight";

  const refresh = useCallback(async () => {
    try {
      const account = await ensureAccount(loadPrefs().name);
      if (!account) {
        setDisabled(true);
        return;
      }
      const [p, c, inv, st, cur] = await Promise.all([
        api<Profile>("/api/players/me"),
        api<{ crates: CrateDTO[] }>("/api/crates"),
        api<{ items: ItemDTO[] }>("/api/players/me/inventory"),
        api<StoreInfo>("/api/store/packs"),
        api<{ transactions: Tx[] }>("/api/players/me/currencies"),
      ]);
      setProfile(p);
      setCrates(c.crates);
      setItems(inv.items);
      setPacks(st);
      setTxs(cur.transactions);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) setDisabled(true);
      else setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the server
    void refresh();
    setPortal(onPortal());
    // Back from Stripe's checkout page: diamonds arrive when Stripe confirms the payment (a few seconds).
    const result = new URLSearchParams(window.location.search).get("purchase");
    if (result === "success") {
      setTab("store");
      setNotice("Payment received — thank you! Your diamonds will appear in a few seconds.");
      const t1 = setTimeout(() => void refresh(), 3000);
      const t2 = setTimeout(() => void refresh(), 10000);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    if (result === "cancelled") setNotice("Purchase cancelled — you were not charged.");
  }, [refresh]);

  const equipped: Cosmetics = {};
  for (const it of items) {
    if (profile?.equipped.skin === it.id) equipped.skin = previewCosmetics(it).skin;
    if (profile?.equipped.hat === it.id) equipped.hat = previewCosmetics(it).hat;
  }

  async function openCrate(c: CrateDTO) {
    setConfirmCrate(null);
    setBusy(true);
    setError(null);
    try {
      const r = await api<OpeningResult>(`/api/crates/${c.id}/open`, { method: "POST", idempotencyKey: newIdempotencyKey() });
      setOpening(r);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function equip(slot: string, itemId: string | null) {
    try {
      await api("/api/players/me/equip", { method: "POST", body: JSON.stringify({ slot, item_id: itemId }) });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function buy(p: Pack) {
    setConfirmPack(null);
    try {
      if (packs?.provider === "stripe") {
        // Real payment: Stripe's hosted page takes the card; we only get told when it is paid.
        const { url } = await api<{ url: string }>("/api/store/checkout", {
          method: "POST",
          body: JSON.stringify({ pack_id: p.id, confirm: true }),
        });
        window.location.assign(url);
        return;
      }
      await api("/api/store/purchases", { method: "POST", idempotencyKey: newIdempotencyKey(),
        body: JSON.stringify({ pack_id: p.id, confirm: true }) });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (disabled) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <div className="panel max-w-md p-6 text-center">
          <h1 className="text-2xl font-bold text-gold">Collection unavailable</h1>
          <p className="mt-2 text-parchment/80">This server runs without a database, so progression and crates are disabled. The game itself is fully playable.</p>
          <Link className="btn mt-4" href="/">Back to menu</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh sky px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <header className="panel mb-4 flex flex-wrap items-center gap-4 p-4">
          <Portrait archetype={archetype} scale={3} cosmetics={equipped} />
          <div className="flex-1">
            <div className="text-xl font-bold">{profile?.display_name ?? "…"}</div>
            <div className="text-sm text-parchment/70">
              Level {profile?.level ?? 1} · {profile?.matches_played ?? 0} matches · {profile?.wins ?? 0} wins
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg" aria-label="Game Points">🪙 {profile?.game_points ?? 0} <span className="text-xs text-parchment/60">Game Points</span></div>
            <div className="text-lg" aria-label="Diamonds">💎 {profile?.diamonds ?? 0} <span className="text-xs text-parchment/60">Diamonds</span></div>
          </div>
          <Link className="btn btn-ghost" href="/">Menu</Link>
        </header>

        <nav className="mb-4 flex gap-2" role="tablist">
          {(["crates", "inventory", "store", "history"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`btn ${tab === t ? "" : "btn-ghost"} capitalize`}>{t}</button>
          ))}
        </nav>
        {error && <p className="panel mb-4 p-3 text-ember" role="alert">{error}</p>}

        {tab === "crates" && (
          <section>
            <p className="mb-3 text-sm text-parchment/80">
              Crates contain <b>cosmetic items only</b> — nothing that affects gameplay. Every item&apos;s exact odds are listed.
              Duplicates convert into Game Points.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {crates.map((c) => {
                const balance = c.currency === "game_points" ? profile?.game_points ?? 0 : profile?.diamonds ?? 0;
                const affordable = balance >= c.price;
                return (
                  <article key={c.id} className="panel flex flex-col gap-2 p-3">
                    <h2 className="font-bold text-gold">{c.name}</h2>
                    <div className="text-lg">{CURRENCY_ICON[c.currency]} {c.price} <span className="text-xs text-parchment/60">{CURRENCY_LABEL[c.currency]}</span></div>
                    <ul className="text-xs">
                      {c.odds_by_rarity.map((o) => (
                        <li key={o.rarity} className="flex justify-between capitalize" style={{ color: RARITY_COLOR[o.rarity] }}>
                          <span>{o.rarity}</span><span>{pct(o.probability)}</span>
                        </li>
                      ))}
                    </ul>
                    <button className="text-left text-xs underline decoration-dotted" onClick={() => setOdds(c)}>All item odds</button>
                    {c.available ? (
                      <button className="btn mt-auto text-sm" disabled={!affordable || busy}
                        style={affordable ? undefined : { opacity: 0.5 }} onClick={() => setConfirmCrate(c)}>
                        {affordable ? "Open…" : `Need ${c.price - balance} more`}
                      </button>
                    ) : (
                      <p className="mt-auto text-xs text-parchment/60">{c.unavailable_reason}</p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {tab === "inventory" && (
          <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.length === 0 && <p className="text-parchment/70">No items yet — open a crate or play matches to earn Game Points.</p>}
            {items.map((it) => {
              const slot = SLOT_FOR[it.kind];
              const isOn = slot ? profile?.equipped[slot] === it.id : false;
              return (
                <article key={it.id} className="panel flex flex-col items-center gap-1 p-3 text-center">
                  {it.kind === "skin" || it.kind === "hat" ? (
                    <Portrait archetype={archetype} scale={3} cosmetics={previewCosmetics(it)} />
                  ) : (
                    <div className="flex h-16 items-center text-3xl">{it.kind === "chat_pack" ? "💬" : "✨"}</div>
                  )}
                  <div className="font-bold" style={{ color: RARITY_COLOR[it.rarity] }}>{it.name}</div>
                  <div className="text-xs capitalize text-parchment/60">{it.rarity} {it.kind.replace("_", " ")}</div>
                  {it.kind === "chat_pack" && (
                    <div className="text-[11px] text-parchment/70">{Object.values(it.data.phrases as Record<string, string>).join(" · ")}</div>
                  )}
                  {slot && (
                    <button className={`btn mt-1 px-2 py-1 text-xs ${isOn ? "btn-ghost" : ""}`} onClick={() => equip(slot, isOn ? null : it.id)}>
                      {isOn ? "Unequip" : "Equip"}
                    </button>
                  )}
                </article>
              );
            })}
          </section>
        )}

        {notice && <p className="panel mb-3 p-3 text-sm text-leaf" role="status">{notice}</p>}
        {tab === "store" && portal && (
          <section className="panel p-4 text-sm text-parchment/80">
            Diamonds can&apos;t be bought on this site. Everything in the game can be earned by playing.
          </section>
        )}
        {tab === "store" && !portal && packs && profile && (
          <section className="panel p-4">
            <p className="mb-3 text-sm text-parchment/80">
              Diamonds are a premium currency bought with <b>real money</b>, also earned occasionally through achievements.
              They open Platinum and Diamond crates. Everything in the game can be enjoyed without buying anything.
            </p>
            <p className="mb-4 border-[1.5px] border-gold bg-well p-2 text-sm text-gold">{packs.notice}</p>
            {!profile.adult_confirmed ? (
              <div className="mb-4 text-sm">
                <p className="mb-2">Purchases are only available to adults.</p>
                <button className="btn btn-ghost text-sm" onClick={async () => {
                  await api("/api/players/me/age", { method: "POST", body: JSON.stringify({ is_adult: true }) });
                  await refresh();
                }}>I confirm I am 18 or older</button>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-3">
              {packs.packs.map((p) => (
                <article key={p.id} className="border-[1.5px] border-ink bg-well p-3 text-center">
                  <div className="text-3xl">💎</div>
                  <div className="font-bold">{p.label}</div>
                  <div>{p.diamonds} Diamonds</div>
                  <div className="text-lg text-gold">${(p.price_usd_cents / 100).toFixed(2)} USD</div>
                  <button className="btn mt-2 text-sm" disabled={!profile.adult_confirmed || packs.provider === "off"}
                    style={profile.adult_confirmed && packs.provider !== "off" ? undefined : { opacity: 0.5 }}
                    onClick={() => setConfirmPack(p)}>{packs.provider === "off" ? "Coming soon" : "Buy…"}</button>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "history" && (
          <section className="panel p-4">
            <table className="w-full text-left text-sm">
              <thead className="text-gold"><tr><th>When</th><th>Reason</th><th className="text-right">Change</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.id}>
                    <td className="py-0.5 text-xs">{new Date(t.created_at).toLocaleString()}</td>
                    <td className="capitalize">{t.reason.replace(/_/g, " ")}</td>
                    <td className={`text-right tabular-nums ${t.amount > 0 ? "text-leaf" : "text-ember"}`}>
                      {t.amount > 0 ? "+" : ""}{t.amount} {CURRENCY_ICON[t.currency]}
                    </td>
                    <td className="text-right tabular-nums">{t.balance_after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {profile && profile.achievements.length > 0 && (
              <div className="mt-4">
                <h3 className="font-bold text-gold">Achievements</h3>
                <ul className="text-sm">{profile.achievements.map((a) => <li key={a.id}>🏆 {a.name} — {a.description}</li>)}</ul>
              </div>
            )}
          </section>
        )}
      </div>

      {odds && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4" onClick={() => setOdds(null)} role="dialog" aria-label={`${odds.name} odds`}>
          <div className="panel max-h-[85dvh] w-full max-w-md overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-xl font-bold text-gold">{odds.name} — exact odds</h2>
            <table className="w-full text-sm">
              <tbody>
                {odds.items.map((i) => (
                  <tr key={i.id}><td style={{ color: RARITY_COLOR[i.rarity] }}>{i.name}</td><td className="capitalize text-parchment/60">{i.rarity}</td>
                    <td className="text-right tabular-nums">{pct(i.probability ?? 0)}</td></tr>
                ))}
              </tbody>
            </table>
            <button className="btn btn-ghost mt-4" onClick={() => setOdds(null)}>Close</button>
          </div>
        </div>
      )}

      {confirmCrate && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-label="Confirm crate">
          <div className="panel w-full max-w-sm p-5 text-center">
            <h2 className="text-xl font-bold text-gold">Open {confirmCrate.name}?</h2>
            <p className="my-2">This costs <b>{CURRENCY_ICON[confirmCrate.currency]} {confirmCrate.price} {CURRENCY_LABEL[confirmCrate.currency]}</b>.</p>
            <p className="text-xs text-parchment/60">Rewards are random cosmetics, drawn on the server with the odds shown.</p>
            <div className="mt-4 flex justify-center gap-3">
              <button className="btn" onClick={() => openCrate(confirmCrate)}>Open crate</button>
              <button className="btn btn-ghost" onClick={() => setConfirmCrate(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {confirmPack && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-label="Confirm purchase">
          <div className="panel w-full max-w-sm p-5 text-center">
            <h2 className="text-xl font-bold text-gold">Confirm real-money purchase</h2>
            <p className="my-2">{confirmPack.diamonds} Diamonds for <b>${(confirmPack.price_usd_cents / 100).toFixed(2)} USD</b>.</p>
            <p className="text-xs text-parchment/60">{packs?.notice}</p>
            <div className="mt-4 flex justify-center gap-3">
              <button className="btn" onClick={() => buy(confirmPack)}>
                {packs?.provider === "stripe" ? "Continue to secure checkout" : "Confirm purchase"}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmPack(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {opening && (
        <OpeningModal
          result={opening}
          crateName={crates.find((c) => c.id === opening.crate_id)?.name ?? "crate"}
          reducedMotion={loadReducedMotion()}
          onEquip={SLOT_FOR[opening.item.kind] ? () => { void equip(SLOT_FOR[opening.item.kind]!, opening.item.id); setOpening(null); } : null}
          onClose={() => setOpening(null)}
        />
      )}
    </main>
  );
}

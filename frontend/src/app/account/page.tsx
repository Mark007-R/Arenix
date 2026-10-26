"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, changePassword, deleteAccount, login, logout, register, whoami } from "@/lib/account";

type Me = Awaited<ReturnType<typeof whoami>>;

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs uppercase tracking-wider text-gold">{label}</span>
      <input
        {...props}
        className="w-full border-[3px] border-ink bg-[#120c1c] px-3 py-2 outline-none focus:border-sky"
      />
    </label>
  );
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Something went wrong. Try again.";
}

export default function AccountPage() {
  const [me, setMe] = useState<Me>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [over13, setOver13] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newPw, setNewPw] = useState("");
  const [delPw, setDelPw] = useState("");

  async function refresh() {
    const m = await whoami();
    setMe(m);
    setLoaded(true);
    if (m?.display_name) setName((n) => n || m.display_name);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the account once on mount
    void refresh();
  }, []);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      setPassword("");
      setConfirm("");
      setNewPw("");
      setDelPw("");
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  const registered = me && !me.is_guest;

  return (
    <main className="min-h-dvh bg-[radial-gradient(ellipse_at_top,#3f6fbf_0%,#2a1f3d_55%,#1f1630_100%)] px-4 py-8">
      <div className="mx-auto max-w-lg">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gold">Your account</h1>
          <Link href="/" className="btn btn-ghost">Menu</Link>
        </div>
        {msg && (
          <p role="status" className={`panel mb-4 p-3 text-sm ${msg.ok ? "text-leaf" : "text-ember"}`}>{msg.text}</p>
        )}
        {!loaded ? null : registered ? (
          <div className="space-y-4">
            <section className="panel p-5">
              <p>
                Signed in as <b>{me.display_name}</b>
                <span className="block text-sm text-parchment/70">{me.email}</span>
              </p>
              <button className="btn btn-ghost mt-3" disabled={busy} onClick={() => run(logout, "Signed out on this device.")}>
                Sign out
              </button>
            </section>
            <section className="panel space-y-3 p-5">
              <h2 className="font-bold text-gold">Change password</h2>
              <Field label="Current password" type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} />
              <Field label="New password (10+ characters)" type="password" autoComplete="new-password" value={newPw}
                onChange={(e) => setNewPw(e.target.value)} />
              <button className="btn" disabled={busy || !password || !newPw}
                onClick={() => run(() => changePassword(password, newPw), "Password changed. Other devices were signed out.")}>
                Update password
              </button>
            </section>
            <section className="panel space-y-3 border-ember p-5">
              <h2 className="font-bold text-ember">Delete account</h2>
              <p className="text-sm text-parchment/75">
                Permanently deletes your account, progress, items and Game Points. This cannot be undone.
              </p>
              <Field label="Password" type="password" autoComplete="current-password" value={delPw}
                onChange={(e) => setDelPw(e.target.value)} />
              <button className="btn" style={{ background: "#9a3029" }} disabled={busy || !delPw}
                onClick={() => {
                  if (window.confirm("Delete your account forever?")) void run(() => deleteAccount(delPw), "Your account was deleted.");
                }}>
                Delete my account
              </button>
            </section>
          </div>
        ) : (
          <section className="panel p-5">
            <div className="mb-4 flex gap-2">
              <button className={`btn flex-1 ${mode === "signup" ? "" : "btn-ghost"}`} onClick={() => setMode("signup")}>Create account</button>
              <button className={`btn flex-1 ${mode === "signin" ? "" : "btn-ghost"}`} onClick={() => setMode("signin")}>Sign in</button>
            </div>
            {mode === "signup" && me?.is_guest && (
              <p className="mb-3 text-sm text-leaf">You&apos;re playing as a guest — creating an account keeps all your progress.</p>
            )}
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (mode === "signin") {
                  void run(() => login(email, password), "Welcome back!");
                } else if (password !== confirm) {
                  setMsg({ ok: false, text: "The passwords don't match." });
                } else {
                  void run(() => register(email, password, name || "Adventurer", over13), "Account created. You're signed in.");
                }
              }}
            >
              <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              {mode === "signup" && (
                <Field label="Display name" maxLength={20} required value={name} onChange={(e) => setName(e.target.value)} />
              )}
              <Field label={mode === "signup" ? "Password (10+ characters)" : "Password"} type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"} required value={password}
                onChange={(e) => setPassword(e.target.value)} />
              {mode === "signup" && (
                <>
                  <Field label="Confirm password" type="password" autoComplete="new-password" required value={confirm}
                    onChange={(e) => setConfirm(e.target.value)} />
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={over13} onChange={(e) => setOver13(e.target.checked)} className="mt-1 accent-[#f4c542]" />
                    <span>
                      I am 13 or older and agree to the <Link className="underline" href="/terms">Terms</Link> and{" "}
                      <Link className="underline" href="/privacy">Privacy Policy</Link>.
                    </span>
                  </label>
                </>
              )}
              <button className="btn w-full" disabled={busy || (mode === "signup" && !over13)}>
                {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
              </button>
            </form>
            <p className="mt-4 text-xs text-parchment/60">
              Forgot your password? Password reset by email is not available yet — contact us from the Privacy page.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

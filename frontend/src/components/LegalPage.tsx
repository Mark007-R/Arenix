import Link from "next/link";
import type { ReactNode } from "react";

export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "";
export const UPDATED = "26 October 2026";

export function Contact() {
  return CONTACT_EMAIL ? (
    <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
  ) : (
    <span>the contact address listed on the game&apos;s store page</span>
  );
}

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-[#1f1630] px-4 py-8">
      <article className="panel mx-auto max-w-3xl space-y-4 p-6 leading-relaxed text-parchment/90 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-gold [&_li]:ml-5 [&_li]:list-disc">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gold">{title}</h1>
          <Link href="/" className="btn btn-ghost">Menu</Link>
        </div>
        <p className="text-sm text-parchment/60">Last updated {UPDATED}</p>
        {children}
      </article>
    </main>
  );
}

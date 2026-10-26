import { Contact, LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Terms of Service — ARENIX" };

export default function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p>By playing ARENIX you agree to these terms. If you don&apos;t agree, please don&apos;t play.</p>
      <h2>Accounts</h2>
      <ul>
        <li>You must be 13 or older to create an account. Keep your password private; you are responsible for your account.</li>
        <li>One person per account. Don&apos;t share, sell or trade accounts.</li>
      </ul>
      <h2>Fair play and conduct</h2>
      <ul>
        <li>No harassment, hate speech, threats, sexual content, or sharing personal information (yours or anyone else&apos;s).</li>
        <li>No cheating, exploiting bugs, automating play, or disrupting servers.</li>
        <li>Lying in-game is part of the game; real-world abuse is not.</li>
        <li>
          We may mute, suspend or delete accounts that break these rules. You can report players from the in-game
          player list.
        </li>
      </ul>
      <h2>Virtual items</h2>
      <ul>
        <li>Game Points, Diamonds and items are cosmetic and have no real-world value. They can&apos;t be exchanged for money.</li>
        <li>Crate odds are always shown before you open one.</li>
        <li>Purchases are final except where the law gives you a right to a refund.</li>
      </ul>
      <h2>The service</h2>
      <p>
        The game is provided &quot;as is&quot;. It may change, have downtime, or lose data despite our efforts. To the
        extent the law allows, we are not liable for indirect losses arising from playing.
      </p>
      <h2>Contact</h2>
      <p><Contact /></p>
    </LegalPage>
  );
}

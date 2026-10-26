import { Contact, LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Privacy Policy — ARENIX" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        ARENIX is a browser game. This page explains what we store, why, and how to delete it. We do not sell your
        data.
      </p>
      <h2>What we store</h2>
      <ul>
        <li><b>Guest players:</b> the display name you choose and a random account key kept in your browser.</li>
        <li>
          <b>Registered players:</b> your email address, display name and a one-way hash of your password (we never
          store the password itself).
        </li>
        <li>
          <b>Game records:</b> finished matches, including chat, votes and moves, to show results, replays and to
          investigate reports; your level, Game Points, Diamonds, items and a history of currency changes.
        </li>
        <li><b>Reports:</b> when someone reports a player, the reason and the reported player&apos;s recent chat lines.</li>
        <li>
          <b>Network data:</b> your IP address is used briefly in server memory to limit abuse (for example too many
          sign-in attempts). We do not keep it in our database.
        </li>
        <li>
          <b>In your browser:</b> your account key, name and settings are kept in local storage. We use no tracking
          cookies.
        </li>
      </ul>
      <h2>Who can see what</h2>
      <p>
        Other players see your display name, character and public chat during a match. Private messages that involve
        a human player are hidden from the public Agent Lab. Moderators can read reports and their evidence.
      </p>
      <p>
        If you create an account, your display name, level, match stats, achievements and recent match results appear
        on a public profile and on the leaderboards. Your email, currencies and items are never shown. Guest players are
        not listed. Deleting your account removes your profile and leaderboard entries.
      </p>
      <h2>Children</h2>
      <p>You must be 13 or older to create an account. If you believe a child under 13 has registered, contact us and we will delete the account.</p>
      <h2>Your choices</h2>
      <ul>
        <li>Delete your account any time from the Account page. This permanently removes your account, progress and items; finished matches keep only your display name.</li>
        <li>Ask us for a copy of your data or for corrections: <Contact />.</li>
      </ul>
      <h2>Payments</h2>
      <p>
        If real-money purchases are offered, payments are handled by the payment provider shown at checkout; we never
        see or store your card details.
      </p>
      <h2>Changes</h2>
      <p>We will update this page when what we collect changes, and show the date above.</p>
      <p>Contact: <Contact /></p>
    </LegalPage>
  );
}

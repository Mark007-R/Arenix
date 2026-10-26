# Releasing ARENIX (free hosting + earning)

This guide takes the game from this repository to a public website, then adds the three ways to
earn: **donations** (Ko-fi), **real-money diamond packs** (Stripe) and **ads on game portals**
(CrazyGames, Poki, itch.io). Every service below has a free plan, and you can sign in to most of
them with GitHub.

> **Never paste passwords or secret keys into chats, issues or commits.** Secret keys go only
> into the hosting dashboard's environment variables (Render → your service → *Environment*).

## What runs where

| Piece | Service | Cost |
|---|---|---|
| The whole game (pages, API, real-time server) | **Render** web service, built from `Dockerfile` | Free |
| Accounts, progression, leaderboards | **Neon** PostgreSQL | Free (0.5 GB) |
| Donations | **Ko-fi** page | Free (Ko-fi takes no cut of one-off donations) |
| Diamond packs | **Stripe** Checkout | No monthly fee; Stripe takes a fee per payment |
| Ad revenue | **CrazyGames**, **Poki**, **itch.io** | Free; portals share ad revenue |

**Free-plan limits:**
- Render's free web services go to sleep after about 15 minutes without visitors. The next
  visitor waits about a minute while it wakes up.
- Every deploy or restart ends the matches running at that moment. Accounts and finished matches
  are kept in the database.
- When you have regular players, Render's paid Starter plan removes the sleep. In the Render
  dashboard, open the service, go to *Settings*, then *Instance type*.

---

## 1. Database: Neon (5 minutes)

1. Go to <https://neon.tech> and sign up with GitHub.
2. Create a project. Name it `arenix` and pick the region nearest to your players.
3. On the project dashboard, open **Connect** and copy the connection string. It looks like
   `postgresql://user:password@ep-something.neon.tech/neondb?sslmode=require`.
   Keep it private: it contains the database password.

The game accepts this URL exactly as Neon gives it. It creates its tables on every start.

## 2. Game server: Render (10 minutes)

1. Go to <https://render.com> and sign up with GitHub. Allow Render to access
   `Mark007-R/Arenix`.
2. Click **New → Blueprint** and pick the `Arenix` repository. Render reads `render.yaml` and
   offers one web service, `arenix`, on the free plan.
3. Fill in the values it asks for:
   - `ARENIX_DATABASE_URL`: the Neon connection string from step 1.
   - `ARENIX_CONTACT_EMAIL`: a public address players can write to. It appears on the Privacy
     and Terms pages.
   - `ARENIX_DONATE_URL`: leave it empty for now (step 3).
   - `ARENIX_PUBLIC_URL`: leave it empty for now.
   - `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`: leave them empty for now (step 4).
4. Click **Apply**. The first build takes about 5–10 minutes.
5. When it shows **Live**, open the URL Render gives you, for example
   `https://arenix-abcd.onrender.com`. Check that:
   - the game loads;
   - **Play practice** works;
   - `https://…/api/health` shows `{"status":"ok"…}`.
6. Set `ARENIX_PUBLIC_URL` to that address, with no trailing slash, and save. Render redeploys.

From now on, every push to `arenix-core-game` redeploys automatically.

**Optional: your own domain.** In the service's *Settings*, open *Custom Domains* and add a domain
you own. Then update `ARENIX_PUBLIC_URL` to the new address.

## 3. Donations: Ko-fi (5 minutes)

1. Create a page at <https://ko-fi.com>. Connect PayPal or Stripe there to receive the money.
2. Copy your page link, for example `https://ko-fi.com/yourname`.
3. On Render, set `ARENIX_DONATE_URL` to that link and save.

A **☕ Support ARENIX** button then appears on the home page and on the end-of-match screen.
Changing the link needs no rebuild. The button is hidden automatically on game portals, whose
rules forbid outside payment links.

## 4. Diamond packs: Stripe (optional, 20 minutes)

Players can buy three diamond packs: $0.99, $4.99 and $9.99. Diamonds only buy cosmetics, and
everything can be earned by playing.
- Only registered accounts can buy. Guests can't, so a cleared browser can't lose paid diamonds.
- Buyers must confirm they are 18 or older.
- Payment happens on Stripe's own page. The game never sees card details.
- Diamonds are added only when Stripe's **signed** webhook confirms the payment. A retried
  webhook never adds them twice.

1. Create an account at <https://stripe.com>. Stripe has to support your country: see
   <https://stripe.com/global>. If it doesn't, skip this step. Donations and portals still work.
2. Start in **Test mode** (the toggle in the dashboard).
3. **API key:**
   - Go to *Developers → API keys* and copy the **Secret key** (`sk_test_…`).
   - On Render, set `STRIPE_SECRET_KEY` to it.
4. **Webhook:**
   - Go to *Developers → Webhooks → Add endpoint*.
   - URL: `https://YOUR-GAME-URL/api/stripe/webhook`.
   - Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
   - Copy the **Signing secret** (`whsec_…`) and set `STRIPE_WEBHOOK_SECRET` to it on Render.
5. **Test a purchase:**
   - In the game, open *Collection & Crates → Store*.
   - Sign in, confirm your age, and buy a pack with the test card `4242 4242 4242 4242`, any
     future date and any CVC.
   - Diamonds should appear within a few seconds.
6. **Go live:**
   - Complete Stripe's account activation (business details and payout bank account).
   - Switch to live mode and create a live secret key and a live webhook, as in steps 3–4.
   - Replace both values on Render.

Without Stripe keys, the store shows the packs as "Coming soon".

## 5. Game portals: ads (CrazyGames, Poki, itch.io)

Portals show the game to millions of players and share the ad revenue.

On a portal, the game runs inside a small **launcher page** that loads the portal's SDK. The
launcher embeds the game from your Render server and reports gameplay start and stop to the
portal. Between matches it plays a "midgame" ad, with the game muted during the ad. On portals,
donations and the diamond store are hidden, as portal rules require.

Build each launcher (you need Node.js):

```bash
cd frontend
npm run build:portal -- crazygames https://YOUR-GAME-URL
npm run build:portal -- poki       https://YOUR-GAME-URL
npm run build:portal -- itch       https://YOUR-GAME-URL
```

Each command writes `frontend/portal-build/<portal>/index.html`. Zip that folder (the
`index.html` must be at the top level of the zip) and upload it.

- **CrazyGames:**
  - Sign up at <https://developer.crazygames.com> and submit the game with the `crazygames` zip.
  - Their QA reviews it in a test environment, where you can check that ads play between matches.
  - Revenue comes from ads; payouts are set up in the developer portal.
- **Poki:**
  - Apply at <https://developers.poki.com>. Poki is selective: they invite games after reviewing
    them. If accepted, upload the `poki` zip in their dashboard and test it in the Poki inspector.
- **itch.io:**
  - Create a project at <https://itch.io/game/new>.
  - Set *Kind of project* to **HTML**, upload the `itch` zip and tick *This file will be played
    in the browser*.
  - Set the viewport to 1280 × 800 and enable the fullscreen button.
  - Under *Pricing*, choose **No payments** or **Donate** (pay what you want). itch.io has no
    ads, so earnings come from donations there.

**Check before you submit:**
- Portals change their rules and SDKs. Read each portal's current developer documentation before
  submitting, and run their QA tool.
- Some portals prefer, or require, games whose files they host themselves. ARENIX needs its
  real-time server, so the launcher loads the game from Render. Mention this when you submit:
  "multiplayer game with its own game server".
- Render's free plan sleeps when idle. For portal traffic, move to a paid instance so players
  don't wait for a cold start.

## 6. Before you announce it

- [ ] Health check `https://…/api/health` is OK, and practice and quick play work.
- [ ] `ARENIX_CONTACT_EMAIL` is set. Read the Privacy and Terms pages (`/privacy/`, `/terms/`)
      and change anything that doesn't fit how you run the game.
- [ ] `ARENIX_ADMIN_TOKEN` was generated by Render. Use it as a Bearer token to read player
      reports: `GET /api/admin/reports`.
- [ ] Stripe was tested in test mode before you switched to live keys.
- [ ] The game says 13+; the store says 18+ for purchases.
- [ ] Income from donations, sales and ads may be taxable where you live. Keep Stripe's and the
      portals' payout reports. This guide is not legal or tax advice.

## Environment variables (hosting)

| Variable | Needed | What it does |
|---|---|---|
| `ARENIX_DATABASE_URL` | recommended | Neon/PostgreSQL URL. Without it, the game runs with no accounts or progression |
| `ARENIX_PUBLIC_URL` | for payments | Your site's address; Stripe sends buyers back here |
| `ARENIX_CONTACT_EMAIL` | yes | Contact address on the legal pages |
| `ARENIX_DONATE_URL` | optional | `https://` donation link (Ko-fi etc.) |
| `STRIPE_SECRET_KEY` | optional | Turns on real diamond purchases |
| `STRIPE_WEBHOOK_SECRET` | with Stripe | Verifies that payment notifications really come from Stripe |
| `ARENIX_ADMIN_TOKEN` | yes (auto) | Protects admin endpoints |
| `ARENIX_CURRENCY` | optional | Checkout currency (default `usd`; prices are in cents of it) |
| `ARENIX_PAID_RANDOM_CRATES` | optional | `disabled` where paid random rewards are restricted |

The Docker image already sets `ARENIX_STATIC_DIR` (serve the pages) and `ARENIX_PRODUCTION=1`
(never fall back to the free mock store).

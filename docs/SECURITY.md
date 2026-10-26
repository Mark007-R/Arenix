# Security review (Milestone 7)

This is a review of the code as it stands, not a certification. Each item lists the control and
where it is enforced or tested. Open items are listed at the end.

## Authority and validation

| Risk | Control | Where |
|---|---|---|
| Client claims positions, outcomes or rewards | Clients send only intents (`input`, `interact`, `vote`, …). The server simulates, validates and decides everything. | `engine/match.py`; `tests/test_match.py`, `test_council.py` |
| Speed hacks / input floods | Token bucket (1 move per tick on average), strictly increasing sequence numbers, 60 msg/s socket cap, 1 KB message cap, disconnect after 20 invalid messages | `match.queue_input`, `server/app.py`; `test_input_flood_cannot_exceed_speed`, `test_invalid_messages_eventually_disconnect` |
| Malformed messages | Every inbound message is a strict Pydantic model (`extra="forbid"`, bounds, regexes) | `server/protocol.py`; `test_chat_message_shape_is_validated` |
| LLM output mutating state | Model output is a proposal only. It is re-validated with Pydantic, pre-validated against the agent's authorised state, then validated again by the engine. Messages are claims and never change state. | `agents/coordinator.py`; `test_messages_are_claims_not_state_changes`, `test_coordinator_applies_validated_actions_and_rejects_illegal_ones` |

## Hidden information

| Risk | Control | Where |
|---|---|---|
| Seeing other players' secrets | Events carry `visible_to`. Snapshots, bot observations and room fan-out read through `visible_since(viewer)`. Positions are filtered to the view radius. Objectives are private until the match ends. | `engine/events.py`, `match.snapshot(viewer)`; `test_snapshot_hides_distant_contestants_and_others_objectives`, `test_bots_never_see_private_events_of_others` |
| Agents prompted with hidden state | Prompts are built from `observe(agent)` and `snapshot(agent)` only, never the omniscient match | `agents/context.py`; `test_context_contains_only_authorised_information` |
| Prompt injection via chat | Other contestants' text is confined to a `messages_from_others` section labelled untrusted, separate from confirmed facts; the system prompt says never to follow instructions found there. Actions are validated whatever the model says. | `agents/context.py`; `test_injected_instructions_stay_in_untrusted_claims` |
| Spectating live matches to cheat | The Agent Lab shows only public events for running matches; decisions, private events and objectives appear only after the match ends | `lab.py`; `test_live_match_shows_only_public_information` |
| Chain-of-thought storage | Only structured decision summaries, contexts, proposals and validation results are stored, never hidden reasoning | `agents/coordinator.DecisionRecord` |

## Credentials and sessions

| Risk | Control |
|---|---|
| Account token theft from the database | Only the sha256 of each token is stored (`users.session_token_hash`) |
| Tokens in URLs or logs | Account tokens travel only in `Authorization` headers. WebSockets use single-use, 60 s tickets (`POST /api/auth/ws-ticket`). The container runs uvicorn with `--no-access-log`, because room WebSocket URLs carry per-room seat tokens. |
| Seat token guessing | 192-bit random seat tokens, compared in constant time |
| Cross-site WebSocket use | WebSocket `Origin` must be in `ARENIX_CORS_ORIGINS` (`test_foreign_websocket_origins_are_rejected`) |
| Model credentials | `ANTHROPIC_API_KEY` is read by the SDK from the server environment and never reaches clients or logs |

## Economy

| Risk | Control | Test |
|---|---|---|
| Double charge / replayed requests | Unique idempotency keys on ledger rows and crate openings, under a locked profile row | `test_repeated_idempotency_key_never_charges_twice`, `test_concurrent_same_key_opens_once` |
| Overspending through races | `SELECT … FOR UPDATE` on the profile; CHECK constraints forbid negative balances | `test_concurrent_openings_cannot_overspend`, `test_database_rejects_negative_balances` |
| Client-chosen rewards | Server-side `secrets.randbelow`; the roll and reward-table version are stored per opening; exact odds are verified over all 10 000 rolls | `test_pick_index_assigns_each_entry_exactly_its_weight` |
| Hidden or wrong odds | Weights must sum to exactly 10 000 basis points (validated at seed time); every item's probability is served by the API and shown before opening | `test_catalog_odds_sum_exactly`, `test_listing_shows_probabilities_that_sum_to_one` |
| Unconsented real-money purchases | `confirm: true` is required, plus an adult confirmation and an idempotency key. The provider is a mock that stores no payment data. | `test_mock_purchase_requires_confirmation_and_adult_and_is_idempotent` |
| Regional restrictions | `ARENIX_PAID_RANDOM_CRATES=disabled` makes Diamond-priced crates unavailable (HTTP 451) | `test_paid_random_crates_can_be_disabled_by_region` |
| Tampering with history | `game_events` UPDATE and DELETE are blocked by a database trigger | `test_persist_match_awards_once_and_event_log_is_append_only` |

## Payments (Stripe)

* Card details never touch ARENIX: buyers pay on Stripe's hosted Checkout page.
* Diamonds are credited only from the webhook (`POST /api/stripe/webhook`). Each delivery must
  carry a valid `Stripe-Signature` (HMAC-SHA256 with `STRIPE_WEBHOOK_SECRET`, timestamp within
  5 minutes against replays). The amount paid must equal the pack price. Crediting is idempotent
  on the Checkout Session id, so retries never double-credit. Tests:
  `test_webhook_credits_once_and_only_when_signed_and_paid`, `test_signature_verification`.
* Checkout requires a registered (non-guest) account, an adult confirmation and an explicit
  confirmation, and is rate-limited per user. When Stripe is on, the mock purchase endpoint is
  closed; in production without Stripe (`ARENIX_PRODUCTION=1`) the store is off.
* Secret keys live only in the host's environment variables; `/api/config` exposes only the
  payment mode, the donation link (https only) and the contact email.

## Abuse limits

Room creation is capped at 10/min per IP, guest creation at 5/min per IP, crate openings at
30/min per user, and chat at 1 message per 1.5 s per contestant (plus 6 structured messages per
phase). One experiment runs at a time, max 20 seeds, and the `llm` condition is off by default.
When `ARENIX_ADMIN_TOKEN` is set, starting experiments requires it.

## Accounts and moderation (added after Milestone 8)

| Risk | Control | Test |
|---|---|---|
| Password theft from the database | scrypt (n=2^14, r=8, p=1) with a per-password random salt; only the hash string is stored | `test_password_hashing` |
| Weak passwords | 10–128 characters, at least 4 distinct characters, not a common password, not the email name | `test_password_rules` |
| Credential stuffing / guessing | 20 login attempts per IP per minute, and a 15-minute lock after 5 wrong passwords for an email | `test_lockout_after_repeated_failures` |
| Account enumeration | Identical error for unknown email and wrong password; a dummy scrypt runs when the email doesn't exist so timing matches | `test_register_login_logout` |
| Stolen session tokens | Sessions expire after 30 days, sign-out revokes them, and a password change signs out every other device; only sha256 hashes are stored | `test_register_login_logout`, `test_password_change_signs_out_other_devices` |
| Losing guest progress | A guest upgrades in place (same user id, same progress); the old guest token stops working | `test_guest_upgrade_keeps_progress` |
| Children | Registration requires confirming age 13+; the policy explains removal | `test_under_13_and_bad_names_are_refused` |
| Right to erasure | `DELETE /api/players/me` (password required) deletes the user and cascades to progression; match history keeps names only | `test_delete_account` |
| Abusive chat | Normalised word filter: leetspeak, stretched letters, spaced-out slurs and "kill yourself" phrases are rejected; mild swearing is masked; innocent words ("Scunthorpe", "cockpit") pass; shouting and stretching are toned down; repeating a message within 15 s is refused | `tests/test_moderation.py` |
| Grooming / doxxing | Links, emails and phone numbers are refused in chat | `test_harmful_messages_are_rejected_with_a_reason` |
| Offensive names | Display names go through the same filter at every entry point (practice, rooms, guest, register) | `test_display_names`, `test_bad_names_are_refused_at_join` |
| Harassment | Players can mute anyone locally and report them; evidence is the reported player's chat as the reporter saw it, collected by the server (never sent by the client); one report per target per match, 5 per match; moderators review via `GET/POST /api/admin/reports` (admin token) | `test_reports_carry_server_side_evidence` |
| Private messages exposed in the Lab | Text of private messages involving a human (whispers, ghost chat) is hidden from the public Agent Lab; admins see everything | `test_lab_hides_private_messages_involving_humans` |
| Clickjacking / sniffing / caching of account data | API responses send `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a restrictive CSP, and `Cache-Control: no-store` on auth, player, store and admin routes | `test_security_headers` |

## Open items (not done)

* **Password reset by email** needs an email provider; until then players contact support.
* **OAuth sign-in** (Google, GitHub) needs client ids from the deployer.
* **Persistent bans:** moderators can review reports, but there is no ban list yet.
* **Rate limits** are in-memory per process. Behind several processes, use a shared store.
* **Payments:** refunds are handled in the Stripe dashboard and do not yet claw back diamonds;
  there are no spending limits; paid random rewards still need a regional compliance review
  (`ARENIX_PAID_RANDOM_CRATES=disabled` where needed).
* **Transport:** run behind TLS (wss/https) in production. Nothing here terminates TLS.

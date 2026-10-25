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

## Abuse limits

Room creation is capped at 10/min per IP, guest creation at 5/min per IP, crate openings at
30/min per user, and chat at 1 message per 1.5 s per contestant (plus 6 structured messages per
phase). One experiment runs at a time, max 20 seeds, and the `llm` condition is off by default.
When `ARENIX_ADMIN_TOKEN` is set, starting experiments requires it.

## Open items (not done)

* **Moderation:** the chat filter is a tiny placeholder blocklist. A real deployment needs a
  moderation service, reporting, and muting or blocking.
* **Accounts:** guest-only, with no recovery or account linking. Tokens never expire.
* **Rate limits** are in-memory per process. Behind several processes, use a shared store.
* **Agent Lab exposure:** after a match ends, its full record (including whispers) is readable by
  anyone with the match id. Restrict this to participants or admins if players expect privacy.
* **Payments:** a real provider needs webhook signature verification, refunds, spending limits and
  regional compliance review, especially for paid random rewards.
* **Transport:** run behind TLS (wss/https) in production. Nothing here terminates TLS.

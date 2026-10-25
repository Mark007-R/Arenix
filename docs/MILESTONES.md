# Milestone checklist

Legend: ✅ done and tested · 🟡 partial · ⬜ not started

## Milestone 1: Pixel-art prototype ✅

- ✅ Original procedural pixel art: 8 character archetypes (3 directions × idle + 2 walk frames),
  terrain tiles, houses, watchtower (ruined and repaired), well, shrine, mine entrance, bell, and
  resource nodes (full and depleted)
- ✅ Emerald Isle map (64×48): village plaza, forest, river with two bridges, mine, castle arena,
  shrine ruins, hidden trail to a secluded glade, spawn points, named regions
- ✅ Camera follow with map bounds, zoom based on viewport size
- ✅ Responsive movement: fixed 20 Hz tick, client prediction, server reconciliation, wall sliding
- ✅ Collision detection, bit-identical between Python and TypeScript (golden vectors)
- ✅ Interactable mission: gather wood and stone, deliver to the watchtower, timer, MVP results
- ✅ Contextual interaction prompts, mission marker, off-screen objective arrow
- ✅ Minimap (milestone rule: all contestants visible)
- ✅ AI contestants: A* navigation, goal selection, stuck recovery, validated interactions
- ✅ Server-authoritative state, append-only event log, deterministic seeded simulation
- ✅ Reduced-motion support, optional touch controls
- ✅ Tests: engine, bots, physics property tests, WebSocket server, TS parity and prediction

## Milestone 2: Multiplayer ✅
- ✅ Rooms with shareable 6-character codes and invite links; capacity of 10 seats
- ✅ Lobby: seat list, ready toggles, change character, host-only start and AI-fill setting,
  map preview, rules, last result
- ✅ Multiple humans per match; AI contestants fill the remaining seats
- ✅ Per-player snapshots with their own `ack_seq`; slow clients get coalesced snapshots and
  never miss events (per-connection event cursor)
- ✅ Reconnect with a seat token (reload, network drop, automatic client retry with backoff);
  `resume_seq` keeps input sequencing valid after a reload; a second tab replaces the first
- ✅ Practice mode runs through the same room code path (a private one-seat room)
- ✅ Sweeper removes stale lobby seats and idle rooms; room creation is rate limited per IP
- ✅ Tests: live-server multi-client integration tests (join, ready, start, sync, reconnect,
  late join, capacity, auth) and a two-browser e2e script (`frontend/e2e/multiplayer.cjs`)
- 🟡 Named realtime events: lobby changes are a `lobby` message and match events ride inside
  snapshots. Separate typed messages per event are deferred until clients need them.
- ⬜ Horizontal scaling: rooms live in one process's memory. Redis pub/sub or sticky routing is
  needed before running more than one server process.

## Milestone 3: Game mechanics ✅ (council mode)
- ✅ Phases: explore → discuss (15 s) → vote (20 s) → reveal (5 s); meetings every 75 s or when
  someone rings the Council Bell (once per contestant). Movement pauses during meetings.
- ✅ Voting: a plurality that beats skips eliminates someone; ties eliminate nobody. Who voted
  is shown live, and who voted for whom at the reveal. Eliminated contestants spectate and can't act.
- ✅ Victory: when time runs out (7 min) or two remain, the top-scoring survivor wins.
  Survival +50, secret objective +60.
- ✅ Missions: Watchtower repair (shared) and the Shrine ritual (a timed co-op challenge where
  3 contestants channel within 10 s, +40 each)
- ✅ Alliances: private offers with a 15 s expiry, accept or decline, one ally at a time,
  cooperation dividend (+3 per unit your ally delivers), allies always visible to each other,
  whispers. Breaking an alliance or voting against your ally is a public betrayal.
- ✅ Chat: public chat and ally-only whispers; 17 predefined quick-chat phrases; free text is
  normalised, stripped of control and bidi characters, length-limited, rate-limited (1.5 s) and
  filtered with a placeholder blocklist (a real deployment must plug in a moderation service)
- ✅ Secret objectives (deliver wood or stone, survive, eliminate X, be allied at the end, wake
  the shrine), private until the results screen
- ✅ Information security: per-recipient event visibility, positions filtered to the view radius
  (13 tiles) plus allies (everyone visible during meetings), roster and scores public, objectives
  private. Bots observe through the same filter (tested).
- ✅ Rule-based bots: a trust model from observed events drives alliance offers and answers,
  votes (with objective-aware targeting), ritual help (allies answer from further away) and
  reactive quick-chat. All of it goes through validated actions.
- ✅ UI: meeting overlay (vote, skip, live voted markers, reveal), chat panel (Enter, Q for
  quick-chat, whisper toggle), speech bubbles, alliance offers, scoreboard actions, objective and
  shrine status, and a results screen with objectives and bonuses
- 🟡 Bots rarely complete the shrine ritual (about 2 in 20 six-bot matches). This is the
  intended baseline for Milestone 4's negotiating agents to beat.
- ⬜ Environmental puzzle mission; additional modes (team objectives, roles)

## Milestone 4: Autonomous AI ✅ (tested offline; not yet exercised against the live Claude API)
- ✅ Structured agent protocol in the engine: 9 message types, message, correlation and phase
  ids, expiry, payload limit, per-phase message limit, negotiation-round limit, private-message
  authorisation. `SYSTEM_EVENT` is server-only. Messages are claims and never change state.
- ✅ `StrategicDecision` schema (structured output, re-validated with Pydantic): goal, timed
  shrine meet-up, messages, votes, alliance moves
- ✅ Gateway: timeout, concurrency limit, one repair retry for invalid output, per-match
  call, token and cost budgets, circuit breaker, latency/token/cost stats
- ✅ Providers: Claude (`AnthropicProvider`: official SDK, `json_schema` output, refusal
  fallbacks via `fallbacks="default"`, typed error handling), a heuristic planner (a
  deterministic policy, *not an LLM*) and a scripted provider for tests
- ✅ Memory (facts kept apart from untrusted claims, negotiation threads, agreements, betrayals,
  server refusals) and trust beliefs. Prompts are built only from the agent's authorised view;
  other contestants' text is confined to a clearly marked untrusted section (tested with an
  injection attempt).
- ✅ Coordinator: never blocks the tick loop; event triggers and staggered beats; stale decisions
  are discarded; pre-validation plus engine validation, linked per decision; deadline fallbacks
  for votes and alliance offers; whole-match fallback on budget or breaker
- ✅ Rooms run strategists for AI seats when `ARENIX_AGENT_PROVIDER` is `heuristic` or
  `anthropic`; the lobby shows the AI mode
- ✅ Measured locally (heuristic strategists, 6 agents, seeds 1–10): shrine activated in 8/10
  matches, versus about 2/20 for the non-communicating rule policy. Numbers come from local runs
  of the code in this repository, and the formal benchmark runner is Milestone 7.
- ⬜ Live-model evaluation: no API credentials were available while building this. The Claude
  request shape and parsing are unit-tested against a fake SDK client only.

## Milestone 5: Progression and crates ✅
- ✅ PostgreSQL with async SQLAlchemy; one Alembic migration creates all 18 tables (FKs, indexes,
  CHECK and UNIQUE constraints). `game_events` is append-only: a trigger rejects UPDATE and DELETE.
- ✅ Finished matches are persisted in one transaction: match row with seed and rules version,
  participants, phase spans, every event with its visibility, agent states, protocol messages,
  decision records and LLM traces. Progression is awarded in that same transaction.
- ✅ Guest accounts with sha256-hashed bearer tokens; profiles (level, XP, stats, achievements,
  equipped loadout)
- ✅ Ledger: every balance change has a unique idempotency key and is written together with the
  locked profile balance; negative balances are impossible (application check plus CHECK
  constraints)
- ✅ Rewards: Game Points per match (participation, score, win, survival) and five achievements
  (some grant Diamonds). Rewards are idempotent per match and user and pushed to the player at
  match end.
- ✅ Five crate tiers configured server-side (Bronze, Silver, Gold for Game Points; Platinum,
  Diamond for Diamonds), with per-item basis-point odds that must sum to exactly 100%. The API and
  UI show every item's exact probability before opening.
- ✅ Opening: explicit confirmation; `secrets.randbelow` on the server; idempotent per
  `Idempotency-Key`; records the roll and reward-table version; duplicates convert to Game Points
  by rarity. Tested: exact odds over all 10 000 rolls, concurrent overspend, concurrent same-key.
- ✅ Diamonds: mock purchase provider with clear real-money prices, explicit confirmation and an
  adult confirmation; no payment data is ever collected. Paid random crates can be disabled per
  deployment (`ARENIX_PAID_RANDOM_CRATES=disabled`).
- ✅ Cosmetics: 10 skins, 5 hats, 4 chat packs, 2 effects, all original and cosmetic only. They are
  loaded server-side into room seats, visible to everyone in lobbies and matches, and chat packs
  unlock extra validated quick-chat phrases.
- ✅ UI: collection page (crates with full odds, confirmation, skippable reveal that respects
  reduced motion, inventory and equip, store, history) and rewards on the results screen
- 🟡 Events are persisted when a match *ends*. A server crash mid-match loses that match (no
  incremental event persistence yet).
- ⬜ Real payment provider, regional detection and direct-purchase shop (for regions where paid
  random crates are disabled), parental controls and spending limits beyond the adult check

## Milestone 6: Agent Lab ⬜
- ⬜ Interaction graph, timeline, decision inspector, replay from the event log, metrics

## Milestone 7: Evaluation and deployment ⬜
- ⬜ Simulation runner comparing independent, communicating and negotiating agents
- ⬜ Security review, model budgets, production deployment docs

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

## Milestone 4: Autonomous AI ✅ (tested offline; not yet exercised against a live LLM API)
- ✅ Structured agent protocol in the engine: 9 message types, message, correlation and phase
  ids, expiry, payload limit, per-phase message limit, negotiation-round limit, private-message
  authorisation. `SYSTEM_EVENT` is server-only. Messages are claims and never change state.
- ✅ `StrategicDecision` schema (structured output, re-validated with Pydantic): goal, timed
  shrine meet-up, messages, votes, alliance moves
- ✅ Gateway: timeout, concurrency limit, one repair retry for invalid output, per-match
  call, token and cost budgets, circuit breaker, latency/token/cost stats
- ✅ Providers: LLM (`AnthropicProvider`: official SDK, `json_schema` output, refusal
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
- ⬜ Live-model evaluation: no API credentials were available while building this. The LLM
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

## Milestone 6: Agent Lab ✅
- ✅ Match list (live rooms and persisted matches). While a match is live, only public
  information is shown; the full record (private events, objectives, contexts, decisions) opens
  when it ends.
- ✅ Interaction graph (SVG, no extra dependency): private messages, alliance offers, formations,
  rejections and breaks, votes, shrine co-participation; toggles per edge type; it grows with the
  replay cursor; click a node to inspect that contestant.
- ✅ Event timeline with type, phase and contestant filters; private events marked; click to jump
  the replay.
- ✅ Decision inspector: (1) authorised observation (facts, untrusted claims, beliefs, legal
  actions), (2) generated proposal, labelled as an explanation and not a fact, (3) pre-validation
  per action, (4) the server's confirmed outcome, plus provider, latency, tokens and estimated cost
- ✅ Replay: play, pause, step and scrub through events. State is rebuilt from the event log only
  by a reducer that exists in Python and TypeScript, kept identical by golden vectors and proven
  equal to the live final state. Position samples (visible to no player) animate the map.
- ✅ Metrics panel per match (decisions, proposals, rejections, latency p50/p95, tokens, cost)
- ✅ Experiments page: run comparisons in the browser (background thread, one at a time), with
  small-multiple bar charts and a full metric table

## Milestone 7: Evaluation and deployment 🟡
- ✅ Simulation runner (`python -m arenix.sim.runner`): same seeds across independent,
  communicate, negotiate, a memory ablation, a negotiation-budget variant and llm. Reports mission
  completion, shrine success, negotiation success, invalid-action rate, coordination failures,
  win rate per slot, latency p50/p95, tokens and estimated cost. `--persist` feeds the Agent Lab.
- ✅ First results from real local runs in `docs/benchmarks/` (heuristic strategists; no LLM
  numbers)
- ✅ Experiments API (`POST /api/experiments`, `GET /api/experiments/{id}/results`); the costly
  `llm` condition is disabled unless `ARENIX_ALLOW_LLM_EXPERIMENTS=1`
- ✅ Model budgets: per-match call, token and cost caps, timeouts, concurrency limit and circuit
  breaker (Milestone 4)
- ✅ Deployment notes and a security review checklist (`docs/DEPLOYMENT.md`, `docs/SECURITY.md`)
- ⬜ LLM benchmark runs (need API credentials and budget)
- ⬜ Horizontal scaling, incremental event persistence, real payments

## Milestone 8: Impostor mode ✅ (rule-based AI; the default for rooms and practice)
- ✅ Hidden roles: one impostor (two from 7 players), each learns only their own role; impostors
  learn their partner. Role and skill events are private; nobody's role is in public data.
- ✅ Kills: impostor only, explore phase, within 1.5 tiles, never another impostor, with a
  cooldown that scales with the field (`roles.kill_cooldown_ticks`) and resets after meetings
- ✅ Unfound deaths stay secret: rosters show the victim alive to islanders until the body is
  reported or a meeting starts (`deaths_revealed`); impostors, ghosts and the victim know
- ✅ Bodies are visible within view range; reporting one (E, within 2 tiles) calls a meeting
  with the victim and location; bodies are cleared at every meeting
- ✅ Witnesses within 6 tiles privately see the kill; the Lookout senses kills within 22 tiles
- ✅ Ghosts roam unseen by the living and chat only with other ghosts
- ✅ Tasks: Watchtower materials plus 5 beacons that each burn 1 wood; impostors can only
  pretend (private `delivery_faked` / `beacon_faked`); task completions are seen only by people
  nearby, and other players' scores and tower contributions stay hidden until the end
- ✅ Win conditions: islanders by ejecting every impostor or finishing every task; impostors
  at parity or when time runs out (9 minutes). Ejections are confirmed.
- ✅ Six per-match skills, all server-enforced: Swift (speed ×1.25, exact in the shared physics
  and the client prediction, with new golden vectors), Scout (view 20 tiles), Strongback (carry
  5), Detective (two-name clue on reporting, one is the killer), Medic (one shield) and Lookout
- ✅ Shrine vision: awakening the shrine shows each channeler one innocent contestant
- ✅ Moonfall Isle: 96×72 (2.25× Emerald Isle), 14 named areas plus fallbacks so every walkable
  tile has a name; every interactable is reachable (tested)
- ✅ Rule-based AI for both roles (`island_bots.py`): sightings memory, suspicion from what they
  saw, proof from witnessed tasks, weighted claims from others; impostors stalk lone islanders,
  strike only when nobody is within 10 tiles, flee, lie consistently and shift the blame
- ✅ Natural chat (`talk.py`): 25+ intents with several wordings each, no repeats until every
  variant is used, region-aware; bots answer "where were you?", defend, agree, doubt and announce
  votes. Human messages are read as untrusted claims (`parse_claim`).
- ✅ UI: role reveal, role/skill card, kill button and K key, Medic shield, bodies, beacons,
  ghost mode, a meeting chat room beside the ballot, confirmed ejections, team results with
  every role and skill revealed
- ✅ Replays (Python and TypeScript) reproduce impostor matches exactly; new replay vectors
- ✅ Balance measured by all-bot simulation (`python -m arenix.sim.impostor_balance`, see
  `docs/benchmarks/README.md`)
- ⬜ LLM strategists for impostor mode (the strategist layer drives classic mode only)
- ⬜ Sabotage, vents, task mini-games

## Milestone 9: Release readiness 🟡
- ✅ Accounts: email + password (scrypt), 30-day revocable sessions, sign-out, password change
  (signs out other devices), guest upgrade that keeps progress, account deletion, 13+ check
- ✅ Login protection: per-IP rate limits, per-email lockout after 5 wrong passwords, no account
  enumeration
- ✅ Moderation: stronger chat filter (leetspeak, stretched letters, spaced slurs, harmful
  phrases; mild swearing masked; links, emails and phone numbers blocked; duplicate spam), name
  checks everywhere, mute and report from the player list and the meeting chat, server-side
  evidence, admin review endpoints
- ✅ Privacy: private human chat hidden in the public Lab; Privacy Policy and Terms pages; API
  security headers
- ✅ Game feel: generated sound effects and music (Web Audio, no asset files), settings menu (volumes, speech bubbles, hide chat, reduced motion), a how-to-play guide shown before the first match, a touch kill button, and a visual polish pass (animated sky, dialog transitions, pulsing kill button, confetti on wins)
- ✅ More content: a secret **sheriff** from 6 players (one bullet; hitting an innocent kills the
  sheriff instead), a **jester** from 9 players (wins alone if voted out), impostor **sabotage**
  (fog that shrinks islanders' view, or dousing a lit beacon), and a winter map, **Frostpeak
  Isle**, with its own palette. The host picks Moonfall, Frostpeak or Random in the lobby;
  practice picks a random island. Bots play all three new roles, and kill cooldowns were retuned
  on both maps (see `docs/benchmarks/README.md`)
- ✅ Social: **quick play** (one click into the busiest open public lobby, which starts itself
  after a 45 s countdown — 5 s once everyone is ready — with AI filling up to 8), a **public room
  browser** (hosts can list a room when creating it or from the lobby), **leaderboards** by wins,
  level and win rate (registered accounts only; win rate needs 10+ matches), and **public
  profiles** with stats, achievements and recent matches (no email, currencies or items)
- ✅ New look: isometric 3D world (Three.js) with jointed, animated low-poly contestants (walk,
  idle, ready-to-strike, death, ghost), view cones, name tags and speech bubbles, a see-through
  hole through walls and trees in front of you, screen-relative movement, auto graphics quality,
  and a cream "drafting table" UI theme across every screen. The Milestone 1 pixel art is retired
- ✅ Release tooling: one deployable container (`Dockerfile`, static web client served by the
  game server, migrations on start), a Render Blueprint (`render.yaml`) for the free plan with
  Neon, runtime settings (`/api/config`), a Ko-fi-style donation button, real diamond packs via
  Stripe Checkout with a signed, idempotent webhook (18+, registered accounts only; the mock store
  is off in production), and a portal launcher with ad breaks between matches for CrazyGames, Poki
  and itch.io. Step-by-step guide: [RELEASE.md](RELEASE.md)
- ⬜ Going live needs the owner's accounts (Render, Neon, Ko-fi, Stripe, portals): see RELEASE.md

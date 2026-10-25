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

## Milestone 2: Multiplayer ⬜
- ⬜ Rooms with shareable codes, capacity limits, lobby, ready states, character selection
- ⬜ Multiple humans per match; AI fills the empty slots
- ⬜ Reconnect tokens and grace period (engine already tracks `connected`)
- ⬜ Typed realtime events (`player_joined`, `mission_started`, …)
- ⬜ Multiplayer integration tests (several clients, one match)

## Milestone 3: Game mechanics ⬜
- ⬜ More missions (shrine activation, puzzle, timed co-op challenge needing 3 contestants)
- ⬜ Public and private chat with predefined messages, rate limits, moderation hooks
- ⬜ Alliances (propose, accept or reject, break)
- ⬜ Meetings, voting, eliminations, more victory conditions, secret objectives

## Milestone 4: Autonomous AI ⬜
- ⬜ LLM gateway (provider-agnostic, mock provider, timeouts, budgets, token and cost metrics)
- ⬜ Agent message protocol with Pydantic validation and authorization
- ⬜ Memory, beliefs, negotiation; the rule-based policy stays as the fallback

## Milestone 5: Progression and crates ⬜
- ⬜ PostgreSQL, SQLAlchemy, Alembic schema; idempotent currency ledger
- ⬜ Game Points, Diamonds (mock payments), five crate tiers, odds shown, server RNG, audit log
- ⬜ Inventory, equipping cosmetics, profiles

## Milestone 6: Agent Lab ⬜
- ⬜ Interaction graph, timeline, decision inspector, replay from the event log, metrics

## Milestone 7: Evaluation and deployment ⬜
- ⬜ Simulation runner comparing independent, communicating and negotiating agents
- ⬜ Security review, model budgets, production deployment docs

| Metric | independent | communicate | negotiate | negotiate_mem0 | negotiate_r1 |
|---|---|---|---|---|---|
| Tower repaired | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Shrine awakened | 10.0% | 20.0% | 100.0% | 100.0% | 100.0% |
| Mission completion (both missions) | 55.0% | 60.0% | 100.0% | 100.0% | 100.0% |
| Negotiation success (plans accepted) | — | — | 98.6% | 98.6% | 0.0% |
| Invalid-action rate | 0.0% | 12.9% | 22.2% | 22.0% | 29.6% |
| Coordination failures / match | 0.2 | 1.8 | 0.6 | 0.6 | 1.3 |
| Eliminations / match | 1.2 | 1.7 | 2.2 | 2.6 | 2.5 |
| Alliances / match | 0.0 | 2.4 | 3.4 | 3.4 | 3.1 |
| Betrayals / match | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| Messages / match | 0.0 | 19.6 | 42.2 | 43.2 | 19.5 |
| Strategist decisions / match | 0.0 | 0.0 | 184.6 | 184.6 | 165.0 |
| Decision failure rate | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| Latency p50 (ms) | — | — | 0.1 | 0.1 | 0.1 |
| Latency p95 (ms) | — | — | 0.2 | 0.3 | 0.2 |
| Tokens / match | 0 | 0 | 0 | 0 | 0 |
| Est. cost / match (USD) | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |

- **independent**: Rule-based bots, no communication (no chat or alliance offers; still vote).
- **communicate**: Rule-based bots with quick-chat and alliances; no coordinated planning.
- **negotiate**: Heuristic strategist agents negotiating over the structured protocol (not an LLM).
- **negotiate_mem0**: As negotiate, with episodic memory disabled (0 facts/claims).
- **negotiate_r1**: As negotiate, with a negotiation budget of 1 round per thread.

Seeds: 1–10 (10 per condition), 6 AI contestants, 420 s matches.

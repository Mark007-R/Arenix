"""Autonomous agent layer: an LLM (or heuristic) strategist above the rule-based bot policy.

Strategists choose *strategy* (goals, messages, alliance moves, votes) from authorised
observations. They never move characters or mutate state: their output is validated here,
queued into the bot's action queue, and validated again by the engine.
"""

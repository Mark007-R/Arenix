"""Pure ARENIX game engine.

This package must not import FastAPI, databases or LLM providers. Everything here is
deterministic given a map, a seed and a sequence of inputs, which is what makes the
server authoritative, testable and (later) replayable from the event log.
"""

"""Provider-agnostic strategist gateway: timeouts, concurrency, retry and cost budgets, traces.

Providers:
* `AnthropicProvider`: Claude via the official SDK with structured JSON output and server-side
  refusal fallback (`fallbacks="default"`).
* `HeuristicProvider`: a deterministic planning policy that speaks the same protocol. It is *not*
  an LLM; it exists so the full agent pipeline (messages, negotiation, validation) runs offline
  and as an experiment baseline.
* `ScriptedProvider`: returns canned responses, for tests.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from pydantic import ValidationError

from .schema import DECISION_JSON_SCHEMA, StrategicDecision

# Per-million-token list prices (USD) used for *estimates* only. Source: Anthropic model table,
# cached 2026-10-06. Unknown models report cost as None rather than guessing.
PRICES_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-opus-5-5": (4.00, 20.00),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-fable-5-1": (10.00, 50.00),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float | None:
    price = PRICES_PER_MTOK.get(model)
    if price is None:
        return None
    return input_tokens * price[0] / 1e6 + output_tokens * price[1] / 1e6


class ProviderError(Exception):
    """A provider failed in a way the gateway reports (and may retry)."""

    def __init__(self, code: str, detail: str = "", retryable: bool = False) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.retryable = retryable


@dataclass
class ProviderResponse:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    served_model: str | None = None


class Provider(Protocol):
    name: str
    model: str
    is_llm: bool

    async def complete(self, system: str, user: str, context: dict[str, Any]) -> ProviderResponse: ...


@dataclass
class Budget:
    max_calls: int = 300
    max_tokens: int = 1_500_000
    max_cost_usd: float = 2.0
    calls: int = 0
    tokens: int = 0
    cost_usd: float = 0.0

    def exhausted(self) -> str | None:
        if self.calls >= self.max_calls:
            return "call_budget"
        if self.tokens >= self.max_tokens:
            return "token_budget"
        if self.cost_usd >= self.max_cost_usd:
            return "cost_budget"
        return None


@dataclass
class GatewayResult:
    decision: StrategicDecision | None
    error: str | None
    provider: str
    model: str
    is_llm: bool
    latency_ms: float
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = 0.0
    attempts: int = 0
    raw_excerpt: str | None = None


@dataclass
class GatewayStats:
    calls: int = 0
    ok: int = 0
    errors: dict[str, int] = field(default_factory=dict)
    latencies_ms: list[float] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


class LLMGateway:
    def __init__(
        self,
        provider: Provider,
        timeout_s: float = 8.0,
        max_concurrency: int = 4,
        budget: Budget | None = None,
        max_attempts: int = 2,
        breaker_threshold: int = 5,
    ) -> None:
        self.provider = provider
        self.timeout_s = timeout_s
        self.semaphore = asyncio.Semaphore(max_concurrency)
        self.budget = budget or Budget()
        self.max_attempts = max_attempts
        self.breaker_threshold = breaker_threshold
        self.consecutive_failures = 0
        self.stats = GatewayStats()

    @property
    def available(self) -> str | None:
        """None if calls may be made, otherwise the reason they may not."""
        if self.consecutive_failures >= self.breaker_threshold:
            return "circuit_open"
        return self.budget.exhausted()

    async def decide(self, system: str, user: str, context: dict[str, Any]) -> GatewayResult:
        p = self.provider
        start = time.perf_counter()
        blocked = self.available
        if blocked:
            return GatewayResult(None, blocked, p.name, p.model, p.is_llm, 0.0)
        attempts = 0
        total_in = total_out = 0
        error: str | None = None
        last_text: str | None = None
        prompt = user
        async with self.semaphore:
            while attempts < self.max_attempts and self.budget.exhausted() is None:
                attempts += 1
                self.budget.calls += 1
                self.stats.calls += 1
                try:
                    resp = await asyncio.wait_for(p.complete(system, prompt, context), timeout=self.timeout_s)
                except TimeoutError:
                    error = "timeout"
                    break  # the decision deadline is gone; don't retry
                except ProviderError as e:
                    error = e.code
                    if e.retryable:
                        continue
                    break
                total_in += resp.input_tokens
                total_out += resp.output_tokens
                self.budget.tokens += resp.input_tokens + resp.output_tokens
                cost = estimate_cost(p.model, resp.input_tokens, resp.output_tokens) if p.is_llm else 0.0
                self.budget.cost_usd += cost or 0.0
                last_text = resp.text
                try:
                    decision = StrategicDecision.model_validate(json.loads(resp.text))
                except (json.JSONDecodeError, ValidationError) as e:
                    error = "invalid_output"
                    # One repair attempt: tell the model exactly what was wrong.
                    prompt = f"{user}\n\nYour previous reply was invalid ({str(e)[:300]}). Reply with valid JSON only."
                    continue
                return self._done(decision, None, start, attempts, total_in, total_out, last_text)
        return self._done(
            None, error or self.budget.exhausted() or "failed", start, attempts, total_in, total_out, last_text
        )

    def _done(
        self,
        decision: StrategicDecision | None,
        error: str | None,
        start: float,
        attempts: int,
        tin: int,
        tout: int,
        text: str | None,
    ) -> GatewayResult:
        p = self.provider
        latency = (time.perf_counter() - start) * 1000
        cost = estimate_cost(p.model, tin, tout) if p.is_llm else 0.0
        self.stats.latencies_ms.append(latency)
        self.stats.input_tokens += tin
        self.stats.output_tokens += tout
        self.stats.cost_usd += cost or 0.0
        if decision is not None:
            self.stats.ok += 1
            self.consecutive_failures = 0
        else:
            self.consecutive_failures += 1
            self.stats.errors[error or "failed"] = self.stats.errors.get(error or "failed", 0) + 1
        return GatewayResult(
            decision, error, p.name, p.model, p.is_llm, latency, tin, tout, cost, attempts, (text or "")[:500] or None
        )


# ---------------------------------------------------------------------------- providers
class AnthropicProvider:
    """Claude through the official SDK. Credentials come from the environment, never the client."""

    name = "anthropic"
    is_llm = True

    def __init__(
        self,
        model: str = "claude-opus-5-5",
        effort: str = "low",
        max_tokens: int = 4000,
        timeout_s: float = 20.0,
        client: Any = None,
    ) -> None:
        self.model = model
        self.effort = effort
        self.max_tokens = max_tokens
        if client is None:
            import anthropic

            # Retries are owned by the gateway (decision deadlines matter more than persistence).
            client = anthropic.AsyncAnthropic(max_retries=0, timeout=timeout_s)
        self.client = client

    async def complete(self, system: str, user: str, context: dict[str, Any]) -> ProviderResponse:
        import anthropic

        try:
            response = await self.client.beta.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_config={
                    "effort": self.effort,
                    "format": {"type": "json_schema", "schema": DECISION_JSON_SCHEMA},
                },
                # Re-run policy declines on Anthropic's recommended model for the refusal category.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.RateLimitError as e:
            raise ProviderError("rate_limited", str(e)[:200], retryable=False) from e
        except anthropic.AuthenticationError as e:
            raise ProviderError("auth_error", "check ANTHROPIC_API_KEY", retryable=False) from e
        except anthropic.BadRequestError as e:
            raise ProviderError("bad_request", str(e)[:200], retryable=False) from e
        except anthropic.APIStatusError as e:
            raise ProviderError(f"http_{e.status_code}", str(e)[:200], retryable=e.status_code >= 500) from e
        except anthropic.APIConnectionError as e:
            raise ProviderError("connection_error", str(e)[:200], retryable=True) from e
        if response.stop_reason == "refusal":
            raise ProviderError("refusal", str(getattr(response, "stop_details", "")))
        if response.stop_reason == "max_tokens":
            raise ProviderError("max_tokens", "output truncated")
        text = "".join(b.text for b in response.content if getattr(b, "type", None) == "text")
        usage = response.usage
        return ProviderResponse(
            text, int(usage.input_tokens or 0), int(usage.output_tokens or 0), getattr(response, "model", self.model)
        )


class ScriptedProvider:
    """Test double: returns queued texts (or calls a function of the context)."""

    name = "scripted"
    model = "scripted"
    is_llm = False

    def __init__(self, responses: list[str] | Callable[[dict[str, Any]], Awaitable[str] | str]) -> None:
        self.responses = responses
        self.calls: list[dict[str, Any]] = []

    async def complete(self, system: str, user: str, context: dict[str, Any]) -> ProviderResponse:
        self.calls.append({"system": system, "user": user, "context": context})
        if callable(self.responses):
            out = self.responses(context)
            text = await out if asyncio.iscoroutine(out) else out
        else:
            if not self.responses:
                raise ProviderError("exhausted")
            text = self.responses.pop(0)
        return ProviderResponse(str(text), input_tokens=len(user) // 4, output_tokens=len(str(text)) // 4)

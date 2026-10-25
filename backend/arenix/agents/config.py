"""Agent configuration from the environment. Credentials are read by the SDK, never stored here."""

from __future__ import annotations

import os
from dataclasses import dataclass

from .gateway import AnthropicProvider, Budget, LLMGateway, Prices, Provider
from .heuristic import HeuristicProvider


@dataclass(frozen=True)
class AgentConfig:
    provider: str = "off"  # off | heuristic | anthropic
    model: str = ""  # required for the anthropic provider (ARENIX_AGENT_MODEL)
    prices: Prices | None = None  # enables the cost budget (ARENIX_AGENT_PRICE_PER_MTOK="in,out")
    effort: str = "low"
    timeout_s: float = 8.0
    max_concurrency: int = 4
    max_calls: int = 300
    max_cost_usd: float = 2.0

    @classmethod
    def from_env(cls) -> AgentConfig:
        e = os.environ
        return cls(
            provider=e.get("ARENIX_AGENT_PROVIDER", "off").lower(),
            model=e.get("ARENIX_AGENT_MODEL", ""),
            prices=_parse_prices(e.get("ARENIX_AGENT_PRICE_PER_MTOK")),
            effort=e.get("ARENIX_AGENT_EFFORT", "low"),
            timeout_s=float(e.get("ARENIX_AGENT_TIMEOUT_S", "8")),
            max_concurrency=int(e.get("ARENIX_AGENT_MAX_CONCURRENCY", "4")),
            max_calls=int(e.get("ARENIX_AGENT_MAX_CALLS_PER_MATCH", "300")),
            max_cost_usd=float(e.get("ARENIX_AGENT_MAX_COST_USD_PER_MATCH", "2.0")),
        )

    @property
    def enabled(self) -> bool:
        return self.provider in ("heuristic", "anthropic")

    def make_gateway(self) -> LLMGateway:
        provider: Provider
        if self.provider == "anthropic":
            if not self.model:
                raise ValueError("ARENIX_AGENT_MODEL must be set to use the anthropic provider")
            provider = AnthropicProvider(
                model=self.model, effort=self.effort, prices=self.prices, timeout_s=self.timeout_s * 2
            )
        elif self.provider == "heuristic":
            provider = HeuristicProvider()
        else:
            raise ValueError("agents are disabled")
        return LLMGateway(
            provider,
            timeout_s=self.timeout_s,
            max_concurrency=self.max_concurrency,
            budget=Budget(max_calls=self.max_calls, max_cost_usd=self.max_cost_usd),
        )


def _parse_prices(raw: str | None) -> Prices | None:
    if not raw:
        return None
    try:
        inp, out = (float(x) for x in raw.split(","))
    except ValueError as e:
        raise ValueError('ARENIX_AGENT_PRICE_PER_MTOK must look like "4,20" (input,output USD per MTok)') from e
    return (inp, out)

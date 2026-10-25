"""Experiment service: run simulation comparisons in a worker thread and keep their results.

Simulations are CPU-bound, so each experiment runs in its own thread and event loop; live rooms
are never stalled. One experiment runs at a time. Results are stored in the database when one is
configured (experiments / experiment_runs tables), otherwise in memory.
"""

from __future__ import annotations

import asyncio
import itertools
import os
import threading
import time
from typing import Any

from ..db.models import Experiment, ExperimentRun
from ..db.session import Database
from .runner import CONDITIONS, run_experiment

MAX_SEEDS = 20


class ExperimentService:
    def __init__(self, db: Database | None) -> None:
        self.db = db
        self.items: dict[int, dict[str, Any]] = {}
        self._ids = itertools.count(1)
        self._lock = threading.Lock()
        self.running: int | None = None

    def validate(self, conditions: list[str], seeds: list[int]) -> None:
        if not conditions or any(c not in CONDITIONS for c in conditions):
            raise ValueError(f"conditions must be from {', '.join(CONDITIONS)}")
        if "llm" in conditions and os.environ.get("ARENIX_ALLOW_LLM_EXPERIMENTS") != "1":
            raise ValueError("the llm condition costs money; enable ARENIX_ALLOW_LLM_EXPERIMENTS=1 on the server")
        if not seeds or len(seeds) > MAX_SEEDS:
            raise ValueError(f"between 1 and {MAX_SEEDS} seeds")

    async def start(
        self, name: str, conditions: list[str], seeds: list[int], contestants: int, time_limit: int
    ) -> dict[str, Any]:
        self.validate(conditions, seeds)
        with self._lock:
            if self.running is not None:
                raise RuntimeError("an experiment is already running")
            exp_id = next(self._ids)
            self.running = exp_id
        config = {"conditions": conditions, "seeds": seeds, "contestants": contestants, "time_limit": time_limit}
        if self.db is not None:
            async with self.db.sessions.begin() as s:
                row = Experiment(name=name, config=config)
                s.add(row)
                await s.flush()
                exp_id = row.id
        item: dict[str, Any] = {
            "id": exp_id,
            "name": name,
            "config": config,
            "status": "running",
            "progress": 0,
            "total": len(conditions) * len(seeds),
            "results": None,
            "error": None,
            "started": time.time(),
        }
        self.items[exp_id] = item
        self.running = exp_id
        loop = asyncio.get_running_loop()

        def work() -> dict[str, Any]:
            async def progress(cond: str, seed: int, metrics: Any) -> None:
                item["progress"] += 1

            return asyncio.run(run_experiment(conditions, seeds, contestants, time_limit, progress=progress))

        async def finish() -> None:
            try:
                results = await loop.run_in_executor(None, work)
                item["results"], item["status"] = results, "finished"
                if self.db is not None:
                    async with self.db.sessions.begin() as s:
                        for run in results["runs"]:
                            s.add(
                                ExperimentRun(
                                    experiment_id=exp_id, condition=run["condition"], seed=run["seed"], metrics=run
                                )
                            )
            except Exception as e:  # report, never crash the server
                item["status"], item["error"] = "failed", f"{type(e).__name__}: {e}"
            finally:
                self.running = None

        item["task"] = asyncio.create_task(finish())
        return self.public(item)

    @staticmethod
    def public(item: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in item.items() if k != "task"}

    def list(self) -> list[dict[str, Any]]:
        return [
            {k: v for k, v in self.public(i).items() if k != "results"}
            for i in sorted(self.items.values(), key=lambda i: -int(i["id"]))
        ]

    def get(self, exp_id: int) -> dict[str, Any] | None:
        item = self.items.get(exp_id)
        return self.public(item) if item else None

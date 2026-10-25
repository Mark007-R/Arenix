"""Mission definitions. Outcomes are decided only by the server-side match."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class RepairTowerMission:
    """Cooperative mission: contestants deliver wood and stone to the ruined watchtower."""

    id: str = "repair_watchtower"
    title: str = "Repair the Watchtower"
    target_id: str = "watchtower"
    required: dict[str, int] = field(default_factory=lambda: {"wood": 10, "stone": 8})
    delivered: dict[str, int] = field(default_factory=lambda: {"wood": 0, "stone": 0})
    contributions: dict[str, int] = field(default_factory=dict)
    status: str = "active"  # active | completed | failed

    def remaining(self) -> dict[str, int]:
        return {r: max(0, self.required[r] - self.delivered.get(r, 0)) for r in self.required}

    def accept(self, contestant_id: str, carrying: dict[str, int]) -> dict[str, int]:
        """Take as much useful cargo as the mission still needs. Returns what was accepted."""
        if self.status != "active":
            return {}
        accepted: dict[str, int] = {}
        for resource, need in self.remaining().items():
            n = min(need, carrying.get(resource, 0))
            if n > 0:
                accepted[resource] = n
                self.delivered[resource] += n
        total = sum(accepted.values())
        if total:
            self.contributions[contestant_id] = self.contributions.get(contestant_id, 0) + total
        if all(v == 0 for v in self.remaining().values()):
            self.status = "completed"
        return accepted

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "target_id": self.target_id,
            "required": self.required,
            "delivered": self.delivered,
            "contributions": self.contributions,
            "status": self.status,
        }

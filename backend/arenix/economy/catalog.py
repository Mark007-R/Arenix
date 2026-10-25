"""Server-side economy configuration: cosmetics, crates, drop weights, prices, packs, rewards.

Everything the client shows about prices and odds is served from here via the API; the frontend
hardcodes none of it. Crates grant cosmetics only — no item affects gameplay.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

RARITIES = ("common", "uncommon", "rare", "epic", "legendary")
WEIGHT_TOTAL = 10_000  # basis points: probabilities are weight / 10 000
DUPLICATE_REFUND = {"common": 20, "uncommon": 50, "rare": 120, "epic": 300, "legendary": 800}


@dataclass(frozen=True)
class Item:
    id: str
    name: str
    kind: str  # skin | hat | chat_pack | effect
    rarity: str
    data: dict[str, Any] = field(default_factory=dict)

    @property
    def refund(self) -> int:
        return DUPLICATE_REFUND[self.rarity]


def _skin(id_: str, name: str, rarity: str, tunic: str, dark: str, accent: str) -> Item:
    return Item(id_, name, "skin", rarity, {"tunic": tunic, "tunicDark": dark, "accent": accent})


ITEMS: list[Item] = [
    # Skins: alternate palettes that apply to any archetype.
    _skin("skin_moss", "Moss Weave", "common", "#6b8f3a", "#53702c", "#c58d55"),
    _skin("skin_clay", "Clay Coat", "common", "#b0683f", "#8a4f2f", "#f4c542"),
    _skin("skin_sky", "Sky Linen", "common", "#5f9fd8", "#467bb0", "#fbf7ee"),
    _skin("skin_rose", "Rosewater", "uncommon", "#d97aa0", "#b35a80", "#fbf7ee"),
    _skin("skin_ember", "Ember Mantle", "uncommon", "#d6453b", "#9a3029", "#ffe066"),
    _skin("skin_frost", "Frostbound", "rare", "#a8d8f0", "#78aed0", "#3f6fbf"),
    _skin("skin_midnight", "Midnight Order", "rare", "#2f2a4a", "#1f1a33", "#a77bf2"),
    _skin("skin_royal", "Royal Gilt", "epic", "#f4c542", "#c9952a", "#d6453b"),
    _skin("skin_obsidian", "Obsidian Oath", "legendary", "#1f1630", "#120c1c", "#86d35f"),
    _skin("skin_starlight", "Starlight Regalia", "legendary", "#d8c2ff", "#a77bf2", "#ffe066"),
    # Hats: drawn over any character.
    Item("hat_party", "Party Hat", "hat", "common", {"style": "party"}),
    Item("hat_flower", "Flower Wreath", "hat", "uncommon", {"style": "flower"}),
    Item("hat_pirate", "Pirate Tricorn", "hat", "rare", {"style": "pirate"}),
    Item("hat_halo", "Questionable Halo", "hat", "epic", {"style": "halo"}),
    Item("hat_horns", "Dragon Horns", "hat", "legendary", {"style": "horns"}),
    # Chat packs: extra predefined phrases (still validated server-side; no free text bypass).
    Item(
        "pack_drama",
        "Drama Pack",
        "chat_pack",
        "common",
        {"phrases": {"drama_gasp": "I can't believe this.", "drama_knew": "I KNEW it!", "drama_fine": "Fine. FINE."}},
    ),
    Item(
        "pack_diplomat",
        "Diplomat Pack",
        "chat_pack",
        "uncommon",
        {
            "phrases": {
                "dip_deal": "Let's make a deal.",
                "dip_terms": "Name your terms.",
                "dip_peace": "Peace, for now.",
            }
        },
    ),
    Item(
        "pack_trickster",
        "Trickster Pack",
        "chat_pack",
        "rare",
        {"phrases": {"trick_who_me": "Who, me?", "trick_trust": "Totally trustworthy.", "trick_oops": "Oops. My bad."}},
    ),
    Item(
        "pack_royal",
        "Royal Decree Pack",
        "chat_pack",
        "epic",
        {
            "phrases": {
                "royal_decree": "By royal decree!",
                "royal_peasants": "Bow, peasants.",
                "royal_crown": "The crown is mine.",
            }
        },
    ),
    # Effects: cosmetic flourishes on your own deliveries.
    Item("effect_sparkle", "Sparkle Trail", "effect", "epic", {"color": "#ffe066", "glyph": "✦"}),
    Item("effect_aurora", "Aurora Burst", "effect", "legendary", {"color": "#86d35f", "glyph": "❖"}),
]
ITEMS_BY_ID = {i.id: i for i in ITEMS}


@dataclass(frozen=True)
class Crate:
    id: str
    name: str
    currency: str  # game_points | diamonds
    price: int
    rarity_weights: dict[str, int]  # basis points per rarity; split evenly among that rarity's items
    sort_order: int

    def entries(self) -> list[tuple[str, int]]:
        """Per-item weights that sum to exactly WEIGHT_TOTAL."""
        out: list[tuple[str, int]] = []
        for rarity, weight in self.rarity_weights.items():
            pool = [i.id for i in ITEMS if i.rarity == rarity]
            base, extra = divmod(weight, len(pool))
            out.extend((item_id, base + (1 if k < extra else 0)) for k, item_id in enumerate(pool))
        return [(i, w) for i, w in out if w > 0]

    def table_version(self) -> str:
        blob = json.dumps({"price": self.price, "currency": self.currency, "entries": self.entries()})
        return hashlib.sha256(blob.encode()).hexdigest()[:16]


CRATES: list[Crate] = [
    Crate("bronze", "Bronze Crate", "game_points", 100, {"common": 7000, "uncommon": 2500, "rare": 500}, 1),
    Crate(
        "silver", "Silver Crate", "game_points", 250, {"common": 4000, "uncommon": 4000, "rare": 1700, "epic": 300}, 2
    ),
    Crate(
        "gold", "Gold Crate", "game_points", 600, {"uncommon": 4000, "rare": 4500, "epic": 1300, "legendary": 200}, 3
    ),
    Crate("platinum", "Platinum Crate", "diamonds", 60, {"rare": 5000, "epic": 4000, "legendary": 1000}, 4),
    Crate("diamond", "Diamond Crate", "diamonds", 150, {"epic": 6500, "legendary": 3500}, 5),
]
CRATES_BY_ID = {c.id: c for c in CRATES}


@dataclass(frozen=True)
class DiamondPack:
    id: str
    diamonds: int
    price_usd_cents: int
    label: str


# Development uses a mock payment provider: no card data is collected or stored, nothing is charged.
DIAMOND_PACKS = [
    DiamondPack("pack_small", 100, 99, "Pouch of Diamonds"),
    DiamondPack("pack_medium", 550, 499, "Chest of Diamonds"),
    DiamondPack("pack_large", 1200, 999, "Vault of Diamonds"),
]
PACKS_BY_ID = {p.id: p for p in DIAMOND_PACKS}

# ---------------------------------------------------------------- progression
STARTING_GAME_POINTS = 150  # enough for a first Bronze crate without grinding


def match_reward(score: int, winner: bool, alive: bool) -> int:
    """Game Points for one match. Generous enough that no one needs to pay to progress."""
    points = 25 + score // 8 + (100 if winner else 0) + (20 if alive else 0)
    return min(points, 400)


def level_for_xp(xp: int) -> int:
    level, need = 1, 200
    while xp >= need:
        xp -= need
        level += 1
        need = int(need * 1.15)
    return level


@dataclass(frozen=True)
class Achievement:
    id: str
    name: str
    description: str
    game_points: int = 0
    diamonds: int = 0


ACHIEVEMENTS = [
    Achievement("first_match", "Castaway", "Finish your first match.", game_points=50),
    Achievement("first_win", "Island Champion", "Win a match.", game_points=100, diamonds=20),
    Achievement("veteran", "Veteran", "Finish 10 matches.", game_points=200, diamonds=30),
    Achievement("builder", "Master Builder", "Deliver 30 materials in total.", game_points=150),
    Achievement("mystic", "Shrine Mystic", "Help awaken the Ancient Shrine.", game_points=100, diamonds=10),
]
ACHIEVEMENTS_BY_ID = {a.id: a for a in ACHIEVEMENTS}


def validate_catalog() -> None:
    """Raise if any crate's odds don't sum exactly or reference unknown items."""
    for c in CRATES:
        total = sum(w for _, w in c.entries())
        if total != WEIGHT_TOTAL:
            raise ValueError(f"{c.id} weights sum to {total}, expected {WEIGHT_TOTAL}")
        if any(i not in ITEMS_BY_ID for i, _ in c.entries()):
            raise ValueError(f"{c.id} references an unknown item")
        if c.currency not in ("game_points", "diamonds"):
            raise ValueError(f"{c.id} has an unknown currency")

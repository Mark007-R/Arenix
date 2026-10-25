"""Map registry. Each map is a module exposing build() -> GameMap."""

from collections.abc import Callable
from functools import cache

from ..map import GameMap
from . import emerald_isle

_BUILDERS: dict[str, Callable[[], GameMap]] = {
    emerald_isle.MAP_ID: emerald_isle.build,
}


@cache
def get_map(map_id: str) -> GameMap:
    try:
        return _BUILDERS[map_id]()
    except KeyError:
        raise KeyError(f"unknown map {map_id!r}") from None


def available_maps() -> list[str]:
    return sorted(_BUILDERS)

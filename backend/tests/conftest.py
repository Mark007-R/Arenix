import pytest

from arenix.engine.map import GameMap
from arenix.engine.maps import get_map


@pytest.fixture
def emerald() -> GameMap:
    return get_map("emerald_isle")

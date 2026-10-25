import math

from hypothesis import given, settings
from hypothesis import strategies as st

from arenix.engine import physics


def open_field(tx: int, ty: int) -> bool:
    return False


def walled(tx: int, ty: int) -> bool:
    # A box of open floor x in [0, 10), y in [0, 10) with a pillar at (5, 5).
    return not (0 <= tx < 10 and 0 <= ty < 10) or (tx, ty) == (5, 5)


def test_moves_at_configured_speed() -> None:
    x, y = physics.step(open_field, 2.0, 2.0, 1.0, 0.0)
    assert math.isclose(x - 2.0, physics.SPEED * physics.DT)
    assert y == 2.0


def test_diagonal_input_is_normalized() -> None:
    x, y = physics.step(open_field, 0.0, 0.0, 1.0, 1.0)
    assert math.isclose(math.hypot(x, y), physics.SPEED * physics.DT)


def test_wall_stops_movement_flush_against_edge() -> None:
    x, y = 9.5, 3.5
    for _ in range(20):
        x, y = physics.step(walled, x, y, 1.0, 0.0)
    assert x < 10.0 - physics.HALF_W
    assert math.isclose(x, 10.0 - physics.HALF_W - physics.EPS)


def test_slides_along_wall_when_moving_diagonally() -> None:
    x, y = 9.6, 3.5
    nx, ny = physics.step(walled, x, y, 1.0, 1.0)
    assert ny > y  # vertical component still applies
    assert not physics.box_blocked(walled, nx, ny)


def test_pillar_blocks() -> None:
    x, y = 3.5, 5.5
    for _ in range(40):
        x, y = physics.step(walled, x, y, 1.0, 0.0)
    assert x < 5.0


@settings(max_examples=300, deadline=None)
@given(
    st.floats(1.0, 9.0),
    st.floats(1.0, 9.0),
    st.lists(st.tuples(st.sampled_from([-1.0, 0.0, 1.0]), st.sampled_from([-1.0, 0.0, 1.0])), max_size=80),
)
def test_never_ends_inside_solid(x0: float, y0: float, inputs: list[tuple[float, float]]) -> None:
    if physics.box_blocked(walled, x0, y0):
        return
    x, y = x0, y0
    for dx, dy in inputs:
        x, y = physics.step(walled, x, y, dx, dy)
        assert not physics.box_blocked(walled, x, y)

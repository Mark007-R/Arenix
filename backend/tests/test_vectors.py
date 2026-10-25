import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "gen_movement_vectors.py"


def test_committed_movement_vectors_are_current() -> None:
    spec = importlib.util.spec_from_file_location("gen", SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.OUT.exists(), "run scripts/gen_movement_vectors.py"
    assert mod.OUT.read_text() == mod.render(), "movement vectors stale: run scripts/gen_movement_vectors.py"


def test_committed_replay_vectors_are_current() -> None:
    script = Path(__file__).resolve().parents[1] / "scripts" / "gen_replay_vectors.py"
    spec = importlib.util.spec_from_file_location("gen_replay", script)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.OUT.read_text() == mod.render(), "replay vectors stale: run scripts/gen_replay_vectors.py"

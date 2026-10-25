import asyncio

from arenix.sim.runner import aggregate, markdown_report, run_experiment, run_one


def test_runner_produces_metrics_for_each_condition() -> None:
    results = asyncio.run(
        run_experiment(["independent", "communicate", "negotiate"], [1, 2], contestants=5, time_limit=120)
    )
    assert set(results["conditions"]) == {"independent", "communicate", "negotiate"}
    assert len(results["runs"]) == 6
    ind = results["conditions"]["independent"]
    assert ind["messages_per_match"] == 0 and ind["alliances_per_match"] == 0  # truly non-communicating
    assert results["conditions"]["negotiate"]["decisions_per_match"] > 0
    report = markdown_report(results)
    assert "| Shrine awakened |" in report and "independent" in report


def test_same_seed_same_condition_is_reproducible() -> None:
    a, _, _ = asyncio.run(run_one("negotiate", 3, contestants=5, time_limit=90))
    b, _, _ = asyncio.run(run_one("negotiate", 3, contestants=5, time_limit=90))
    fields = ("winner", "tower_repaired", "shrine_activated", "eliminations", "messages", "plans_proposed")
    assert [getattr(a, f) for f in fields] == [getattr(b, f) for f in fields]
    assert aggregate([a, b])["runs"] == 2

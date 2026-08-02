from pathlib import Path

import pytest

from bmo_piper.benchmark import ensure_safe_to_start, percentile, summarize_records


def test_percentile_requires_supported_sample_size():
    assert percentile([1, 2, 3, 4, 5], 95) is None
    assert percentile(list(range(1, 21)), 95) == 20


def test_summary_separates_cold_and_warm_and_reports_maximum():
    records = [
        {"mode": "cold", "phrase_class": "short", "total_seconds": 4.0},
        {"mode": "warm", "phrase_class": "short", "total_seconds": 1.0},
        {"mode": "warm", "phrase_class": "short", "total_seconds": 2.0},
        {"mode": "warm", "phrase_class": "short", "total_seconds": 3.0},
    ]

    summary = summarize_records(records)

    assert summary["cold"]["short"]["median_seconds"] == 4.0
    assert summary["warm"]["short"]["median_seconds"] == 2.0
    assert summary["warm"]["short"]["maximum_seconds"] == 3.0
    assert summary["warm"]["short"]["p95_seconds"] is None


def test_benchmark_refuses_new_work_after_warning(tmp_path: Path):
    ensure_safe_to_start(tmp_path)
    (tmp_path / "warning").write_text("warning\n", encoding="utf-8")
    with pytest.raises(RuntimeError, match="host monitor"):
        ensure_safe_to_start(tmp_path)

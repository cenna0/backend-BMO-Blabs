import json
import subprocess

import pytest

from bmo_piper import host_monitor
from bmo_piper.host_monitor import MonitorState, Sample, evaluate_sample, fail_closed


def healthy_sample(**changes):
    values = {
        "host_mem_available": 2 * 1024**3,
        "free_disk": 30 * 1024**3,
        "kernel_oom": 6,
        "baseline_kernel_oom": 6,
        "backend_healthy": True,
        "audio_healthy": True,
        "hermes_healthy": True,
        "backend_restarts": 0,
        "audio_restarts": 0,
        "candidate_oom": False,
        "candidate_restarts": 0,
    }
    values.update(changes)
    return Sample(**values)


def test_monitor_warning_and_abort_thresholds_are_exact():
    assert evaluate_sample(healthy_sample(host_mem_available=1280 * 1024**2)) == "ok"
    assert evaluate_sample(healthy_sample(host_mem_available=1279 * 1024**2)) == "warning"
    assert evaluate_sample(healthy_sample(host_mem_available=1023 * 1024**2)) == "controlled"
    assert evaluate_sample(healthy_sample(host_mem_available=749 * 1024**2)) == "emergency"


def test_monitor_stops_on_production_or_candidate_fault():
    assert evaluate_sample(healthy_sample(audio_healthy=False)) == "abort"
    assert evaluate_sample(healthy_sample(candidate_oom=True)) == "abort"
    assert evaluate_sample(healthy_sample(kernel_oom=7)) == "abort"
    assert evaluate_sample(healthy_sample(free_disk=19 * 1024**3)) == "abort"


def test_controlled_abort_requires_five_consecutive_samples():
    state = MonitorState()

    for _ in range(4):
        assert state.observe("controlled") == "controlled"
    assert state.abort is False
    assert state.observe("controlled") == "abort"
    assert state.abort is True


def test_controlled_counter_resets_and_emergency_is_immediate():
    state = MonitorState()
    state.observe("controlled")
    assert state.controlled_samples == 1
    assert state.observe("warning") == "warning"
    assert state.controlled_samples == 0
    assert state.observe("emergency") == "abort"
    assert state.abort is True


def test_monitor_failure_writes_abort_and_stops_exact_candidate(tmp_path):
    stopped = []

    result = fail_closed(tmp_path, "candidate-exact", RuntimeError("inspect failed"), stopped.append)

    assert result == 2
    assert stopped == ["candidate-exact"]
    marker = json.loads((tmp_path / "abort").read_text(encoding="utf-8"))
    assert marker["reason"] == "monitor failure"
    assert marker["candidate"] == "candidate-exact"


def test_monitor_failure_records_cleanup_failure(tmp_path):
    def fail(_name):
        raise RuntimeError("cleanup failed")

    result = fail_closed(tmp_path, "candidate-exact", RuntimeError("inspect failed"), fail)

    assert result == 3
    marker = json.loads((tmp_path / "abort").read_text(encoding="utf-8"))
    assert marker["cleanup"] == "failed"


def test_inspect_distinguishes_absent_container_from_docker_failure(monkeypatch):
    def absent(*_args, **_kwargs):
        return subprocess.CompletedProcess([], 1, "", "error: no such object: exact")

    monkeypatch.setattr(host_monitor.subprocess, "run", absent)
    assert host_monitor._inspect("exact") is None

    def broken(*_args, **_kwargs):
        return subprocess.CompletedProcess([], 1, "", "daemon unavailable")

    monkeypatch.setattr(host_monitor.subprocess, "run", broken)
    with pytest.raises(RuntimeError, match="inspect failed"):
        host_monitor._inspect("exact")

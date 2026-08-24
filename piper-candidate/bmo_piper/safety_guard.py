from __future__ import annotations

from pathlib import Path
import shutil

from .host_monitor import Sample, _http_status, _inspect, _kernel_oom, _mem_available, evaluate_sample


def production_safety_guard(baseline_kernel_oom: int) -> None:
    backend = _inspect("bmo-production-backend-1")
    audio = _inspect("bmo-production-audio-1")
    if backend is None or audio is None:
        raise RuntimeError("production container missing")
    sample = Sample(
        host_mem_available=_mem_available(),
        free_disk=shutil.disk_usage("/opt/bmo/temp").free,
        kernel_oom=_kernel_oom(Path("/sys/fs/cgroup/system.slice/memory.events")),
        baseline_kernel_oom=baseline_kernel_oom,
        backend_healthy=backend["State"].get("Health", {}).get("Status") == "healthy"
        and _http_status("https://api.personalbmo.web.id/health") == 200
        and _http_status("https://api.personalbmo.web.id/livez") == 404
        and _http_status("https://api.personalbmo.web.id/readyz") == 404,
        audio_healthy=audio["State"].get("Health", {}).get("Status") == "healthy",
        hermes_healthy=_http_status("http://127.0.0.1:8642/health") == 200,
        backend_restarts=int(backend.get("RestartCount", 0)),
        audio_restarts=int(audio.get("RestartCount", 0)),
        candidate_oom=bool(audio["State"].get("OOMKilled")),
        candidate_restarts=0,
    )
    if evaluate_sample(sample) != "ok":
        raise RuntimeError("production safety gate is not green")

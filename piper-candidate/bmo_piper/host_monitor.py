from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import argparse
import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request


GIB = 1024**3
MIB = 1024**2


@dataclass(frozen=True)
class Sample:
    host_mem_available: int
    free_disk: int
    kernel_oom: int
    baseline_kernel_oom: int
    backend_healthy: bool
    audio_healthy: bool
    hermes_healthy: bool
    backend_restarts: int
    audio_restarts: int
    candidate_oom: bool
    candidate_restarts: int


@dataclass
class MonitorState:
    controlled_samples: int = 0
    abort: bool = False

    def observe(self, decision: str) -> str:
        if decision == "controlled":
            self.controlled_samples += 1
            if self.controlled_samples >= 5:
                self.abort = True
                return "abort"
            return "controlled"
        self.controlled_samples = 0
        if decision in {"abort", "emergency"}:
            self.abort = True
            return "abort"
        return decision


def evaluate_sample(sample: Sample) -> str:
    if (
        sample.free_disk < 20 * GIB
        or sample.kernel_oom != sample.baseline_kernel_oom
        or not sample.backend_healthy
        or not sample.audio_healthy
        or not sample.hermes_healthy
        or sample.backend_restarts != 0
        or sample.audio_restarts != 0
        or sample.candidate_oom
        or sample.candidate_restarts != 0
    ):
        return "abort"
    if sample.host_mem_available < 750 * MIB:
        return "emergency"
    if sample.host_mem_available < GIB:
        return "controlled"
    if sample.host_mem_available < int(1.25 * GIB):
        return "warning"
    return "ok"


def _mem_available() -> int:
    for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
        if line.startswith("MemAvailable:"):
            return int(line.split()[1]) * 1024
    raise RuntimeError("MemAvailable unavailable")


def _kernel_oom(path: Path) -> int:
    for line in path.read_text(encoding="ascii").splitlines():
        if line.startswith("oom_kill "):
            return int(line.split()[1])
    raise RuntimeError("oom_kill unavailable")


def _http_status(url: str, timeout: float = 3.0) -> int:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return int(response.status)
    except urllib.error.HTTPError as error:
        return int(error.code)
    except (OSError, urllib.error.URLError):
        return 0


def _inspect(name: str) -> dict[str, Any] | None:
    result = subprocess.run(
        ["docker", "inspect", name],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=5,
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.lower()
        if "no such object" in stderr or "no such container" in stderr:
            return None
        raise RuntimeError("docker inspect failed")
    try:
        data = json.loads(result.stdout)
    except ValueError as error:
        raise RuntimeError("docker inspect returned malformed JSON") from error
    return data[0] if data else None


def _container_state(inspect: dict[str, Any] | None) -> tuple[bool, int, bool]:
    if not inspect:
        return False, 0, False
    state = inspect["State"]
    health = state.get("Health", {}).get("Status")
    healthy = bool(state.get("Running")) and (health in {None, "healthy"})
    return healthy, int(inspect.get("RestartCount", 0)), bool(state.get("OOMKilled"))


def _stop_candidate(name: str) -> None:
    try:
        subprocess.run(
            ["docker", "stop", "--time", "5", name],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass
    remaining = _inspect(name)
    if remaining is not None:
        removed = subprocess.run(
            ["docker", "rm", "--force", name],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
        if removed.returncode != 0:
            raise RuntimeError("candidate removal failed")
    if _inspect(name) is not None:
        raise RuntimeError("candidate cleanup could not be verified")


def fail_closed(
    control_root: Path,
    candidate: str,
    error: BaseException,
    stopper: Any = _stop_candidate,
) -> int:
    payload: dict[str, Any] = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "reason": "monitor failure",
        "candidate": candidate,
        "error_type": type(error).__name__,
        "cleanup": "requested",
    }
    try:
        stopper(candidate)
        payload["cleanup"] = "verified"
        result = 2
    except BaseException as cleanup_error:
        payload["cleanup"] = "failed"
        payload["cleanup_error_type"] = type(cleanup_error).__name__
        result = 3
    _write_marker(control_root, "abort", payload)
    return result


def _write_marker(control_root: Path, name: str, payload: dict[str, Any]) -> None:
    control_root.mkdir(parents=True, exist_ok=True)
    (control_root / name).write_text(
        json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--control-root", type=Path, required=True)
    parser.add_argument("--baseline-kernel-oom", type=int, required=True)
    parser.add_argument(
        "--kernel-events",
        type=Path,
        default=Path("/sys/fs/cgroup/system.slice/memory.events"),
    )
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--public-base", default="https://api.personalbmo.web.id")
    args = parser.parse_args()
    if shutil.which("docker") is None:
        raise RuntimeError("docker CLI unavailable")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.control_root.mkdir(parents=True, exist_ok=True)
    state = MonitorState()
    candidate_seen = False
    try:
        with args.output.open("a", encoding="utf-8") as stream:
            while True:
                backend_inspect = _inspect("bmo-production-backend-1")
                audio_inspect = _inspect("bmo-production-audio-1")
                candidate_inspect = _inspect(args.candidate)
                if candidate_inspect is None and candidate_seen:
                    return 0
                if candidate_inspect is None:
                    time.sleep(min(args.interval, 0.2))
                    continue
                candidate_seen = True
                backend_healthy, backend_restarts, _ = _container_state(backend_inspect)
                audio_healthy, audio_restarts, _ = _container_state(audio_inspect)
                _, candidate_restarts, candidate_oom = _container_state(candidate_inspect)
                public_health = _http_status(f"{args.public_base}/health")
                public_livez = _http_status(f"{args.public_base}/livez")
                public_readyz = _http_status(f"{args.public_base}/readyz")
                hermes_status = _http_status("http://127.0.0.1:8642/health")
                sample = Sample(
                    host_mem_available=_mem_available(),
                    free_disk=shutil.disk_usage("/opt/bmo/temp").free,
                    kernel_oom=_kernel_oom(args.kernel_events),
                    baseline_kernel_oom=args.baseline_kernel_oom,
                    backend_healthy=(
                        backend_healthy
                        and public_health == 200
                        and public_livez == 404
                        and public_readyz == 404
                    ),
                    audio_healthy=audio_healthy,
                    hermes_healthy=hermes_status == 200,
                    backend_restarts=backend_restarts,
                    audio_restarts=audio_restarts,
                    candidate_oom=candidate_oom,
                    candidate_restarts=candidate_restarts,
                )
                raw_decision = evaluate_sample(sample)
                decision = state.observe(raw_decision)
                payload = {
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    **sample.__dict__,
                    "public_health": public_health,
                    "public_livez": public_livez,
                    "public_readyz": public_readyz,
                    "hermes_status": hermes_status,
                    "raw_decision": raw_decision,
                    "decision": decision,
                    "controlled_samples": state.controlled_samples,
                }
                stream.write(json.dumps(payload, sort_keys=True) + "\n")
                stream.flush()
                if raw_decision in {"warning", "controlled"}:
                    _write_marker(args.control_root, "warning", payload)
                if decision == "abort":
                    _write_marker(args.control_root, "abort", payload)
                    _stop_candidate(args.candidate)
                    return 2
                time.sleep(args.interval)
    except BaseException as error:
        return fail_closed(args.control_root, args.candidate, error)


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

from pathlib import Path
from typing import Any
import argparse
import hashlib
import json
import os
import subprocess
import time

from .host_monitor import _http_status, _inspect, _kernel_oom


CONTAINERS = (
    "bmo-production-backend-1",
    "bmo-production-audio-1",
    "bmo-telegram-relay",
    "bmo-beszel-agent",
    "bmo-beszel-hub",
)


def parse_meminfo(payload: str) -> dict[str, int]:
    wanted = {
        "MemTotal:": "mem_total_bytes",
        "MemAvailable:": "mem_available_bytes",
        "SwapTotal:": "swap_total_bytes",
    }
    result: dict[str, int] = {}
    for line in payload.splitlines():
        fields = line.split()
        if fields and fields[0] in wanted:
            result[wanted[fields[0]]] = int(fields[1]) * 1024
    if set(result) != set(wanted.values()):
        raise RuntimeError("required meminfo fields unavailable")
    return result


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _container(name: str) -> dict[str, Any]:
    inspect = _inspect(name)
    if inspect is None:
        return {"name": name, "exists": False}
    container_id = inspect["Id"]
    memory_path = Path(
        f"/sys/fs/cgroup/system.slice/docker-{container_id}.scope/memory.current"
    )
    state = inspect["State"]
    environment = inspect.get("Config", {}).get("Env", [])
    rvc_enabled = next(
        (item.split("=", 1)[1] for item in environment if item.startswith("RVC_ENABLED=")),
        None,
    )
    return {
        "name": name,
        "exists": True,
        "id": container_id,
        "image": inspect["Image"],
        "running": bool(state.get("Running")),
        "health": state.get("Health", {}).get("Status"),
        "restart_count": int(inspect.get("RestartCount", 0)),
        "oom_killed": bool(state.get("OOMKilled")),
        "memory_current_bytes": int(memory_path.read_text(encoding="ascii")),
        "rvc_enabled": rvc_enabled,
    }


def _run(command: list[str]) -> str:
    return subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=20,
        check=False,
    ).stdout.strip()


def _service_property(service: str, name: str) -> str:
    return _run(["systemctl", "show", service, f"--property={name}", "--value"])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--stage", required=True)
    args = parser.parse_args()
    meminfo = parse_meminfo(Path("/proc/meminfo").read_text(encoding="ascii"))
    containers = [_container(name) for name in CONTAINERS]
    paths = {
        "production_compose": Path("/opt/bmo/app/docker-compose.yml"),
        "audio_environment": Path("/opt/bmo/config/audio.env"),
    }
    disk = os.statvfs("/opt/bmo/temp")
    snapshot = {
        "schema_version": 1,
        "stage": args.stage,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **meminfo,
        "load_average": os.getloadavg(),
        "process_count": sum(path.name.isdigit() for path in Path("/proc").iterdir()),
        "kernel_oom_kill": _kernel_oom(
            Path("/sys/fs/cgroup/system.slice/memory.events")
        ),
        "disk_free_bytes": disk.f_bavail * disk.f_frsize,
        "containers": containers,
        "container_memory_total_bytes": sum(
            int(item.get("memory_current_bytes", 0)) for item in containers
        ),
        "hermes": {
            "active": _run(["systemctl", "is-active", "hermes-gateway"]),
            "memory_current_bytes": int(_service_property("hermes-gateway", "MemoryCurrent")),
            "restart_count": int(_service_property("hermes-gateway", "NRestarts")),
            "health_status": _http_status("http://127.0.0.1:8642/health"),
        },
        "caddy_active": _run(["systemctl", "is-active", "caddy"]),
        "public": {
            "health": _http_status("https://api.personalbmo.web.id/health"),
            "livez": _http_status("https://api.personalbmo.web.id/livez"),
            "readyz": _http_status("https://api.personalbmo.web.id/readyz"),
        },
        "loopback_listeners": _run(
            ["ss", "-ltnp", "sport = :3000 or sport = :8001 or sport = :8642"]
        ).splitlines(),
        "docker_disk_usage": _run(["docker", "system", "df"]),
        "configuration_sha256": {
            name: _sha256(path) for name, path in paths.items()
        },
        "candidate_image": json.loads(
            _run(["docker", "image", "inspect", "bmo-piper:p8-prudence-candidate"])
            or "[]"
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(snapshot, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

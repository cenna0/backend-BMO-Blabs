#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Callable, Iterable, Sequence


GIB = 1024**3
MINIMUM_MEMORY_AVAILABLE_BYTES = 5 * GIB
MINIMUM_FREE_DISK_BYTES = 20 * GIB
MODEL_PATH = "/opt/bmo/models"
TEMP_AUDIO_PATH = "/opt/bmo/temp/audio"
OOM_LOOKBACK_HOURS = 24
SENSITIVE_LABEL = re.compile(
    r"(?:api[-_]?key|credential|password|private[-_]?key|secret|token)",
    re.IGNORECASE,
)
SAFE_LABEL_CHARACTERS = re.compile(r"[^A-Za-z0-9_.:@%/+ -]")
OOM_PATTERNS = {
    "cgroup_out_of_memory": re.compile(
        r"memory cgroup out of memory",
        re.IGNORECASE,
    ),
    "killed_process": re.compile(r"\bkilled process \d+", re.IGNORECASE),
    "oom_killer": re.compile(
        r"(?:invoked oom-killer|\boom-kill(?:er)?\b)",
        re.IGNORECASE,
    ),
    "out_of_memory": re.compile(r"\bout of memory\b", re.IGNORECASE),
}


@dataclass(frozen=True)
class PathFilesystem:
    requested_path: str
    probe_path: str | None
    device_id: str | None
    mount_point: str | None
    filesystem_type: str | None
    source: str | None
    free_bytes: int | None


@dataclass(frozen=True)
class ContainerMemory:
    name: str
    usage: str
    percentage: str


@dataclass(frozen=True)
class TopProcess:
    pid: int
    name: str
    rss_bytes: int


@dataclass(frozen=True)
class SystemSnapshot:
    total_memory_bytes: int | None
    available_memory_bytes: int | None
    swap_total_bytes: int | None
    swap_free_bytes: int | None
    filesystem_observations: tuple[PathFilesystem, ...]
    docker_data_root: str | None
    docker_inventory_available: bool
    unexpected_app_containers: tuple[str, ...]
    container_memory_usage: tuple[ContainerMemory, ...] | None
    load_average: tuple[float, float, float] | None
    top_memory_consumers: tuple[TopProcess, ...] | None
    oom_status: str
    oom_signatures: tuple[str, ...]


def _safe_label(value: str) -> str:
    if SENSITIVE_LABEL.search(value):
        return "[redacted]"
    cleaned = SAFE_LABEL_CHARACTERS.sub("_", value).strip()
    return cleaned[:80] or "[unknown]"


def _safe_path(value: str | None) -> str | None:
    if value is None:
        return None
    if SENSITIVE_LABEL.search(value):
        return "[redacted]"
    cleaned = re.sub(r"[^A-Za-z0-9_./:@+ -]", "_", value).strip()
    return cleaned[:512] or "[unknown]"


def _safe_metric(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9.%/ ]", "_", value).strip()
    return cleaned[:80] or "[unknown]"


def _deduplicate_filesystems(
    observations: Iterable[PathFilesystem],
) -> list[dict[str, object]]:
    grouped: dict[str, list[PathFilesystem]] = {}
    for observation in observations:
        key = (
            f"device:{observation.device_id}"
            if observation.device_id is not None
            else f"unknown:{observation.requested_path}"
        )
        grouped.setdefault(key, []).append(observation)

    filesystems: list[dict[str, object]] = []
    for key in sorted(grouped):
        group = grouped[key]
        known_free = [
            item.free_bytes for item in group if item.free_bytes is not None
        ]
        free_bytes = min(known_free) if len(known_free) == len(group) else None
        status = (
            "UNKNOWN"
            if free_bytes is None
            else "PASS"
            if free_bytes >= MINIMUM_FREE_DISK_BYTES
            else "FAIL"
        )
        filesystems.append(
            {
                "device_id": group[0].device_id,
                "mount_points": sorted(
                    {
                        _safe_path(item.mount_point) or "[unknown]"
                        for item in group
                    },
                ),
                "filesystem_types": sorted(
                    {
                        _safe_label(item.filesystem_type)
                        if item.filesystem_type
                        else "[unknown]"
                        for item in group
                    },
                ),
                "sources": sorted(
                    {
                        _safe_path(item.source) or "[unknown]"
                        for item in group
                    },
                ),
                "paths": sorted(
                    _safe_path(item.requested_path) or "[unknown]"
                    for item in group
                ),
                "probe_paths": sorted(
                    _safe_path(item.probe_path) or "[unknown]"
                    for item in group
                ),
                "free_bytes": free_bytes,
                "free_gib": (
                    round(free_bytes / GIB, 2)
                    if free_bytes is not None
                    else None
                ),
                "status": status,
            },
        )
    return filesystems


def evaluate_snapshot(snapshot: SystemSnapshot) -> dict[str, object]:
    warnings: list[str] = []
    filesystems = _deduplicate_filesystems(snapshot.filesystem_observations)

    memory_status = (
        "PASS"
        if (
            snapshot.available_memory_bytes is not None
            and snapshot.available_memory_bytes
            >= MINIMUM_MEMORY_AVAILABLE_BYTES
        )
        else "FAIL"
    )
    if snapshot.total_memory_bytes is None:
        warnings.append("TOTAL_MEMORY_UNKNOWN")
    if snapshot.available_memory_bytes is None:
        warnings.append("MEMORY_AVAILABLE_UNKNOWN")
    if snapshot.swap_total_bytes is None or snapshot.swap_free_bytes is None:
        warnings.append("SWAP_STATE_UNKNOWN")

    disk_status = (
        "PASS"
        if filesystems
        and all(item["status"] == "PASS" for item in filesystems)
        and snapshot.docker_data_root is not None
        else "FAIL"
    )
    if snapshot.docker_data_root is None:
        warnings.append("DOCKER_DATA_ROOT_UNKNOWN")
    if any(item["status"] == "UNKNOWN" for item in filesystems):
        warnings.append("FILESYSTEM_CAPACITY_UNKNOWN")

    if snapshot.oom_status == "DETECTED":
        oom_gate_status = "FAIL"
    elif snapshot.oom_status == "OK":
        oom_gate_status = "PASS"
    else:
        oom_gate_status = "UNKNOWN"
        warnings.append("RECENT_OOM_DIAGNOSTICS_UNKNOWN")

    application_container_status = (
        "FAIL"
        if (
            not snapshot.docker_inventory_available
            or snapshot.unexpected_app_containers
        )
        else "PASS"
    )
    if not snapshot.docker_inventory_available:
        warnings.append("DOCKER_CONTAINER_INVENTORY_UNKNOWN")

    if snapshot.container_memory_usage is None:
        warnings.append("CONTAINER_MEMORY_USAGE_UNKNOWN")
    if snapshot.load_average is None:
        warnings.append("LOAD_AVERAGE_UNKNOWN")
    if snapshot.top_memory_consumers is None:
        warnings.append("TOP_MEMORY_CONSUMERS_UNKNOWN")

    unexpected_containers = [
        _safe_label(name) for name in snapshot.unexpected_app_containers
    ]
    container_memory_usage = (
        None
        if snapshot.container_memory_usage is None
        else [
            {
                "name": _safe_label(item.name),
                "usage": _safe_metric(item.usage),
                "percentage": _safe_metric(item.percentage),
            }
            for item in snapshot.container_memory_usage
        ]
    )
    top_memory_consumers = (
        None
        if snapshot.top_memory_consumers is None
        else [
            {
                "pid": item.pid,
                "name": _safe_label(item.name),
                "rss_bytes": item.rss_bytes,
                "rss_mib": round(item.rss_bytes / (1024**2), 2),
            }
            for item in snapshot.top_memory_consumers
        ]
    )

    hard_checks = {
        "memory": {
            "status": memory_status,
            "available_bytes": snapshot.available_memory_bytes,
            "minimum_bytes": MINIMUM_MEMORY_AVAILABLE_BYTES,
        },
        "disk": {
            "status": disk_status,
            "minimum_free_bytes_per_filesystem": MINIMUM_FREE_DISK_BYTES,
        },
        "recent_oom": {
            "status": oom_gate_status,
            "lookback_hours": OOM_LOOKBACK_HOURS,
        },
        "application_containers": {
            "status": application_container_status,
            "unexpected_count": len(unexpected_containers),
        },
    }
    failures = [
        name
        for name, check in hard_checks.items()
        if check["status"] != "PASS"
    ]

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "thresholds": {
            "minimum_memory_available_bytes": MINIMUM_MEMORY_AVAILABLE_BYTES,
            "minimum_memory_available_gib": 5,
            "minimum_free_disk_bytes": MINIMUM_FREE_DISK_BYTES,
            "minimum_free_disk_gib": 20,
            "oom_lookback_hours": OOM_LOOKBACK_HOURS,
        },
        "memory": {
            "total_bytes": snapshot.total_memory_bytes,
            "total_gib": (
                round(snapshot.total_memory_bytes / GIB, 2)
                if snapshot.total_memory_bytes is not None
                else None
            ),
            "available_bytes": snapshot.available_memory_bytes,
            "available_gib": (
                round(snapshot.available_memory_bytes / GIB, 2)
                if snapshot.available_memory_bytes is not None
                else None
            ),
            "swap_total_bytes": snapshot.swap_total_bytes,
            "swap_total_gib": (
                round(snapshot.swap_total_bytes / GIB, 2)
                if snapshot.swap_total_bytes is not None
                else None
            ),
            "swap_free_bytes": snapshot.swap_free_bytes,
            "swap_free_gib": (
                round(snapshot.swap_free_bytes / GIB, 2)
                if snapshot.swap_free_bytes is not None
                else None
            ),
        },
        "filesystems": filesystems,
        "docker": {
            "docker_data_root": _safe_path(snapshot.docker_data_root),
            "inventory_status": (
                "OK" if snapshot.docker_inventory_available else "UNKNOWN"
            ),
            "unexpected_app_containers": unexpected_containers,
            "container_memory_usage": container_memory_usage,
        },
        "diagnostics": {
            "load_average": (
                None
                if snapshot.load_average is None
                else {
                    "one_minute": snapshot.load_average[0],
                    "five_minutes": snapshot.load_average[1],
                    "fifteen_minutes": snapshot.load_average[2],
                }
            ),
            "top_memory_consumers": top_memory_consumers,
            "oom": {
                "status": snapshot.oom_status,
                "lookback_hours": OOM_LOOKBACK_HOURS,
                "signatures": sorted(
                    _safe_label(signature)
                    for signature in snapshot.oom_signatures
                ),
            },
        },
        "hard_checks": hard_checks,
        "warnings": sorted(set(warnings)),
        "failures": failures,
        "result": "FAIL" if failures else "PASS",
    }


def _format_gib(value: object) -> str:
    return "UNKNOWN" if value is None else f"{value} GiB"


def render_human(report: dict[str, object]) -> str:
    thresholds = report["thresholds"]
    memory = report["memory"]
    docker = report["docker"]
    diagnostics = report["diagnostics"]
    hard_checks = report["hard_checks"]
    lines = [
        "P7 resource preflight",
        (
            "Thresholds: "
            f"MemAvailable >= {thresholds['minimum_memory_available_gib']} GiB; "
            "free disk >= "
            f"{thresholds['minimum_free_disk_gib']} GiB per filesystem"
        ),
        (
            "Memory: "
            f"total={_format_gib(memory['total_gib'])}; "
            f"available={_format_gib(memory['available_gib'])}; "
            f"gate={hard_checks['memory']['status']}"
        ),
        (
            "Swap: "
            f"total={_format_gib(memory['swap_total_gib'])}; "
            f"free={_format_gib(memory['swap_free_gib'])}"
        ),
        (
            "Load average: UNKNOWN"
            if diagnostics["load_average"] is None
            else (
                "Load average: "
                f"{diagnostics['load_average']['one_minute']:.2f} "
                f"{diagnostics['load_average']['five_minutes']:.2f} "
                f"{diagnostics['load_average']['fifteen_minutes']:.2f}"
            )
        ),
        "Filesystems:",
    ]
    for filesystem in report["filesystems"]:
        lines.append(
            "  - "
            f"device={filesystem['device_id'] or 'UNKNOWN'} "
            f"mounts={','.join(filesystem['mount_points'])} "
            f"free={_format_gib(filesystem['free_gib'])} "
            f"status={filesystem['status']} "
            f"paths={','.join(filesystem['paths'])}",
        )
    lines.extend(
        [
            (
                "Docker: "
                f"data-root={docker['docker_data_root'] or 'UNKNOWN'}; "
                f"inventory={docker['inventory_status']}; "
                "unexpected app containers="
                f"{len(docker['unexpected_app_containers'])}"
            ),
            "Container memory:",
        ],
    )
    if docker["container_memory_usage"] is None:
        lines.append("  - UNKNOWN")
    elif not docker["container_memory_usage"]:
        lines.append("  - none")
    else:
        for container in docker["container_memory_usage"]:
            lines.append(
                "  - "
                f"{container['name']}: {container['usage']} "
                f"({container['percentage']})",
            )
    lines.append("Top memory consumers:")
    if diagnostics["top_memory_consumers"] is None:
        lines.append("  - UNKNOWN")
    else:
        for process in diagnostics["top_memory_consumers"]:
            lines.append(
                "  - "
                f"pid={process['pid']} name={process['name']} "
                f"rss={process['rss_mib']} MiB",
            )
    lines.append(
        "Recent OOM evidence: "
        f"{diagnostics['oom']['status']} "
        f"(last {diagnostics['oom']['lookback_hours']}h; "
        f"signatures={','.join(diagnostics['oom']['signatures']) or 'none'})",
    )
    if report["warnings"]:
        lines.append("Warnings: " + ", ".join(report["warnings"]))
    if report["failures"]:
        lines.append("Failed gates: " + ", ".join(report["failures"]))
    lines.append(f"FINAL: {report['result']}")
    return "\n".join(lines) + "\n"


def render_json(report: dict[str, object]) -> str:
    return json.dumps(report, indent=2, sort_keys=True) + "\n"


def _run_command(
    command: Sequence[str],
    *,
    timeout_seconds: int = 8,
) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            env={**os.environ, "LC_ALL": "C"},
        )
    except (OSError, subprocess.SubprocessError):
        return None


def _read_meminfo() -> dict[str, int]:
    try:
        content = Path("/proc/meminfo").read_text(encoding="utf-8")
    except OSError:
        return {}
    values: dict[str, int] = {}
    for line in content.splitlines():
        key, separator, raw_value = line.partition(":")
        if not separator:
            continue
        fields = raw_value.split()
        if not fields or not fields[0].isdigit():
            continue
        multiplier = 1024 if len(fields) > 1 and fields[1] == "kB" else 1
        values[key] = int(fields[0]) * multiplier
    return values


def _docker_data_root() -> str | None:
    result = _run_command(
        ["docker", "info", "--format", "{{.DockerRootDir}}"],
    )
    if result is None or result.returncode != 0:
        return None
    value = result.stdout.strip()
    if not value.startswith("/") or "\n" in value:
        return None
    return value


def _container_looks_like_application(
    *,
    name: str,
    image: str,
    compose_project: str,
    compose_service: str,
) -> bool:
    if (
        compose_project == "bmo-production"
        and compose_service in {"audio", "backend"}
    ):
        return True
    normalized_name = name.lower()
    if re.fullmatch(
        r"(?:bmo[-_])?(?:production[-_])?"
        r"(?:backend|audio(?:[-_]service)?)(?:[-_]\d+)?",
        normalized_name,
    ):
        return True
    image_leaf = image.rsplit("/", 1)[-1].split("@", 1)[0].split(":", 1)[0]
    return image_leaf.lower() in {"bmo-audio", "bmo-backend"}


def _docker_inventory() -> tuple[bool, tuple[str, ...]]:
    template = (
        '{{.Names}}\t{{.Image}}\t'
        '{{.Label "com.docker.compose.project"}}\t'
        '{{.Label "com.docker.compose.service"}}'
    )
    result = _run_command(["docker", "ps", "--format", template])
    if result is None or result.returncode != 0:
        return False, ()
    unexpected: list[str] = []
    for line in result.stdout.splitlines():
        fields = line.split("\t")
        if len(fields) != 4:
            return False, ()
        name, image, compose_project, compose_service = fields
        if _container_looks_like_application(
            name=name,
            image=image,
            compose_project=compose_project,
            compose_service=compose_service,
        ):
            unexpected.append(name)
    return True, tuple(sorted(unexpected))


def _container_memory_usage() -> tuple[ContainerMemory, ...] | None:
    result = _run_command(
        [
            "docker",
            "stats",
            "--no-stream",
            "--format",
            "{{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}",
        ],
    )
    if result is None or result.returncode != 0:
        return None
    usage: list[ContainerMemory] = []
    for line in result.stdout.splitlines():
        fields = line.split("\t")
        if len(fields) != 3:
            return None
        usage.append(
            ContainerMemory(
                name=fields[0],
                usage=fields[1],
                percentage=fields[2],
            ),
        )
    return tuple(sorted(usage, key=lambda item: item.name))


def _unescape_mountinfo(value: str) -> str:
    replacements = {
        r"\040": " ",
        r"\011": "\t",
        r"\012": "\n",
        r"\134": "\\",
    }
    for encoded, decoded in replacements.items():
        value = value.replace(encoded, decoded)
    return value


def _mountinfo() -> list[tuple[str, str, str, str]]:
    try:
        content = Path("/proc/self/mountinfo").read_text(encoding="utf-8")
    except OSError:
        return []
    mounts: list[tuple[str, str, str, str]] = []
    for line in content.splitlines():
        left, separator, right = line.partition(" - ")
        if not separator:
            continue
        left_fields = left.split()
        right_fields = right.split()
        if len(left_fields) < 5 or len(right_fields) < 2:
            continue
        mounts.append(
            (
                left_fields[2],
                _unescape_mountinfo(left_fields[4]),
                right_fields[0],
                _unescape_mountinfo(right_fields[1]),
            ),
        )
    return mounts


def _nearest_existing_path(path: str) -> Path | None:
    candidate = Path(path)
    while True:
        try:
            candidate.stat()
            return candidate
        except FileNotFoundError:
            parent = candidate.parent
            if parent == candidate:
                return None
            candidate = parent
        except OSError:
            return None


def _filesystem_observation(
    requested_path: str,
    mounts: Sequence[tuple[str, str, str, str]],
) -> PathFilesystem:
    probe = _nearest_existing_path(requested_path)
    if probe is None:
        return PathFilesystem(
            requested_path=requested_path,
            probe_path=None,
            device_id=None,
            mount_point=None,
            filesystem_type=None,
            source=None,
            free_bytes=None,
        )
    try:
        file_stat = probe.stat()
        filesystem_stat = os.statvfs(probe)
    except OSError:
        return PathFilesystem(
            requested_path=requested_path,
            probe_path=str(probe),
            device_id=None,
            mount_point=None,
            filesystem_type=None,
            source=None,
            free_bytes=None,
        )
    device_id = f"{os.major(file_stat.st_dev)}:{os.minor(file_stat.st_dev)}"
    probe_path = str(probe.resolve())
    matching_mounts = [
        item
        for item in mounts
        if item[0] == device_id
        and (
            probe_path == item[1]
            or probe_path.startswith(item[1].rstrip("/") + "/")
        )
    ]
    selected_mount = (
        max(matching_mounts, key=lambda item: len(item[1]))
        if matching_mounts
        else (device_id, "[unknown]", "[unknown]", "[unknown]")
    )
    return PathFilesystem(
        requested_path=requested_path,
        probe_path=probe_path,
        device_id=device_id,
        mount_point=selected_mount[1],
        filesystem_type=selected_mount[2],
        source=selected_mount[3],
        free_bytes=filesystem_stat.f_bavail * filesystem_stat.f_frsize,
    )


def _load_average() -> tuple[float, float, float] | None:
    try:
        values = Path("/proc/loadavg").read_text(encoding="ascii").split()
        return float(values[0]), float(values[1]), float(values[2])
    except (OSError, ValueError, IndexError):
        return None


def _top_memory_consumers() -> tuple[TopProcess, ...] | None:
    processes: list[TopProcess] = []
    try:
        entries = list(Path("/proc").iterdir())
    except OSError:
        return None
    for entry in entries:
        if not entry.name.isdigit():
            continue
        try:
            content = (entry / "status").read_text(encoding="utf-8")
        except OSError:
            continue
        name: str | None = None
        rss_bytes: int | None = None
        for line in content.splitlines():
            if line.startswith("Name:"):
                name = line.partition(":")[2].strip()
            elif line.startswith("VmRSS:"):
                fields = line.partition(":")[2].split()
                if fields and fields[0].isdigit():
                    rss_bytes = int(fields[0]) * 1024
        if name is not None and rss_bytes is not None:
            processes.append(
                TopProcess(
                    pid=int(entry.name),
                    name=name,
                    rss_bytes=rss_bytes,
                ),
            )
    if not processes:
        return None
    return tuple(
        sorted(processes, key=lambda process: process.rss_bytes, reverse=True)[:5],
    )


def _recent_oom_evidence() -> tuple[str, tuple[str, ...]]:
    commands = (
        (
            "journalctl",
            "--dmesg",
            f"--since=-{OOM_LOOKBACK_HOURS}h",
            "--no-pager",
            "--quiet",
        ),
        (
            "dmesg",
            "--since",
            f"{OOM_LOOKBACK_HOURS} hours ago",
            "--nopager",
        ),
    )
    for command in commands:
        result = _run_command(command)
        if result is None or result.returncode != 0:
            continue
        signatures = tuple(
            sorted(
                name
                for name, pattern in OOM_PATTERNS.items()
                if pattern.search(result.stdout)
            ),
        )
        return ("DETECTED" if signatures else "OK"), signatures
    return "UNKNOWN", ()


def collect_system_snapshot() -> SystemSnapshot:
    memory = _read_meminfo()
    docker_data_root = _docker_data_root()
    docker_inventory_available, unexpected_containers = _docker_inventory()
    mounts = _mountinfo()
    required_paths = [
        docker_data_root or "[docker-data-root-unknown]",
        MODEL_PATH,
        TEMP_AUDIO_PATH,
    ]
    filesystem_observations = tuple(
        _filesystem_observation(path, mounts) for path in required_paths
    )
    oom_status, oom_signatures = _recent_oom_evidence()
    return SystemSnapshot(
        total_memory_bytes=memory.get("MemTotal"),
        available_memory_bytes=memory.get("MemAvailable"),
        swap_total_bytes=memory.get("SwapTotal"),
        swap_free_bytes=memory.get("SwapFree"),
        filesystem_observations=filesystem_observations,
        docker_data_root=docker_data_root,
        docker_inventory_available=docker_inventory_available,
        unexpected_app_containers=unexpected_containers,
        container_memory_usage=_container_memory_usage(),
        load_average=_load_average(),
        top_memory_consumers=_top_memory_consumers(),
        oom_status=oom_status,
        oom_signatures=oom_signatures,
    )


def _failed_snapshot() -> SystemSnapshot:
    return SystemSnapshot(
        total_memory_bytes=None,
        available_memory_bytes=None,
        swap_total_bytes=None,
        swap_free_bytes=None,
        filesystem_observations=(
            PathFilesystem(
                requested_path="[collection-failed]",
                probe_path=None,
                device_id=None,
                mount_point=None,
                filesystem_type=None,
                source=None,
                free_bytes=None,
            ),
        ),
        docker_data_root=None,
        docker_inventory_available=False,
        unexpected_app_containers=(),
        container_memory_usage=None,
        load_average=None,
        top_memory_consumers=None,
        oom_status="UNKNOWN",
        oom_signatures=(),
    )


def main(
    argv: Sequence[str] | None = None,
    *,
    collector: Callable[[], SystemSnapshot] | None = None,
) -> int:
    parser = argparse.ArgumentParser(
        description="Read-only P7 VPS resource preflight.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="emit machine-readable JSON",
    )
    arguments = parser.parse_args(argv)
    active_collector = collector or collect_system_snapshot
    try:
        snapshot = active_collector()
    except Exception:
        snapshot = _failed_snapshot()
    report = evaluate_snapshot(snapshot)
    output = render_json(report) if arguments.json else render_human(report)
    sys.stdout.write(output)
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())

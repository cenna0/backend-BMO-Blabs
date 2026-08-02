from __future__ import annotations

from pathlib import Path
import argparse
import json
import subprocess
import tempfile
import time

from .failure_suite import IMAGE, _base, _run
from .kokoro_reference import _production_guard


def _wait_for(path: Path, timeout_seconds: float = 20) -> float:
    started = time.perf_counter()
    while not path.is_file():
        if time.perf_counter() - started >= timeout_seconds:
            raise RuntimeError(f"shutdown phase did not become active: {path.name}")
        time.sleep(0.02)
    return time.perf_counter() - started


def _orphan_pids() -> list[int]:
    result: list[int] = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            command = (entry / "cmdline").read_bytes().replace(b"\0", b" ")
        except OSError:
            continue
        if b"bmo_piper.shutdown_target" in command:
            result.append(int(entry.name))
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--text-set", type=Path, required=True)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--baseline-kernel-oom", type=int, required=True)
    args = parser.parse_args()
    assets = args.assets.resolve(strict=True)
    workspace = args.workspace.resolve(strict=True)
    shutdown_root = workspace / "shutdown-output"
    shutdown_root.mkdir(exist_ok=True)
    text_payload = json.loads(args.text_set.read_text(encoding="utf-8"))
    continuous = next(
        item["text"] for item in text_payload["phrases"] if item["id"] == "continuous"
    )
    records: list[dict[str, object]] = []
    for phase in ("startup", "model-loading", "synthesis", "ffmpeg", "idle"):
        _production_guard(args.baseline_kernel_oom)
        output = Path(tempfile.mkdtemp(prefix=f"{phase}-", dir=shutdown_root))
        name = f"bmo-p8-piper-shutdown-{phase}"
        command = _base(name, assets, output)
        command.remove("--rm")
        command.insert(2, "--detach")
        command += [
            "python",
            "-m",
            "bmo_piper.shutdown_target",
            "--phase",
            phase,
            "--manifest",
            "/assets/PIPER_ASSET_MANIFEST.json",
            "--output-root",
            "/output",
            "--text",
            continuous,
        ]
        start_result = _run(command, timeout=20)
        if start_result.returncode != 0:
            raise RuntimeError(f"failed to start shutdown phase {phase}")
        ready_seconds = _wait_for(output / f"{phase}.active")
        if phase == "synthesis":
            time.sleep(0.25)
        stop_started = time.perf_counter()
        stop_result = _run(["docker", "stop", "--time", "5", name], timeout=10)
        stop_seconds = time.perf_counter() - stop_started
        inspect = json.loads(_run(["docker", "inspect", name]).stdout)[0]
        state = inspect["State"]
        log_tail = _run(["docker", "logs", name]).stderr.strip().splitlines()[-5:]
        _run(["docker", "rm", name])
        time.sleep(0.05)
        generated = [
            path.name
            for path in output.iterdir()
            if path.is_file() and path.name != f"{phase}.active"
        ]
        records.append(
            {
                "phase": phase,
                "became_active_seconds": ready_seconds,
                "stop_command_exit_code": stop_result.returncode,
                "shutdown_seconds": stop_seconds,
                "container_exit_code": state["ExitCode"],
                "oom_killed": state["OOMKilled"],
                "restart_count": inspect.get("RestartCount", 0),
                "generated_files_after": generated,
                "orphan_pids_after": _orphan_pids(),
                "stderr_tail": log_tail,
            }
        )
        _production_guard(args.baseline_kernel_oom)
    containers_after = _run(
        ["docker", "ps", "-aq", "--filter", "name=bmo-p8-piper-shutdown-"]
    ).stdout.split()
    passed = all(
        record["stop_command_exit_code"] == 0
        and record["container_exit_code"] == 0
        and record["oom_killed"] is False
        and record["restart_count"] == 0
        and not record["generated_files_after"]
        and not record["orphan_pids_after"]
        and float(record["shutdown_seconds"]) <= 5.0
        for record in records
    ) and not containers_after
    args.results.parent.mkdir(parents=True, exist_ok=True)
    args.results.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "passed": passed,
                "normal_path_sigkill_required": False,
                "records": records,
                "candidate_containers_after": containers_after,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())

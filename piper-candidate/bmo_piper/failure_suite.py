from __future__ import annotations

from pathlib import Path
import argparse
import json
import shutil
import subprocess
import tempfile
import time

from .kokoro_reference import _production_guard


IMAGE = "bmo-piper:p8-prudence-candidate"


def _base(name: str, assets: Path, output: Path, *, read_only_output: bool = False) -> list[str]:
    output_mount = f"type=bind,src={output},dst=/output"
    if read_only_output:
        output_mount += ",readonly"
    return [
        "docker",
        "run",
        "--rm",
        "--name",
        name,
        "--network",
        "none",
        "--restart",
        "no",
        "--memory",
        "1073741824",
        "--memory-swap",
        "1073741824",
        "--cpus",
        "2",
        "--pids-limit",
        "128",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,noexec,size=268435456",
        "--user",
        "1002:1002",
        "--mount",
        f"type=bind,src={assets},dst=/assets,readonly",
        "--mount",
        output_mount,
        IMAGE,
    ]


def _run(command: list[str], timeout: float = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
        check=False,
    )


def _startup_assets(source: Path, root: Path, mode: str) -> Path:
    target = Path(tempfile.mkdtemp(prefix=f"{mode}-", dir=root))
    manifest_name = "PIPER_ASSET_MANIFEST.json"
    manifest = json.loads((source / manifest_name).read_text(encoding="utf-8"))
    for artifact in manifest["artifacts"]:
        filename = artifact["filename"]
        if mode == "missing-model" and artifact["role"] == "model":
            continue
        if mode == "missing-config" and artifact["role"] == "config":
            continue
        shutil.copy2(source / filename, target / filename)
    if mode == "hash-mismatch":
        for artifact in manifest["artifacts"]:
            if artifact["role"] == "model":
                artifact["sha256"] = "0" * 64
    (target / manifest_name).write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return target


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
    failure_assets = workspace / "failure-assets"
    failure_output = workspace / "failure-output"
    failure_assets.mkdir(exist_ok=True)
    failure_output.mkdir(exist_ok=True)
    text_payload = json.loads(args.text_set.read_text(encoding="utf-8"))
    continuous = next(
        item["text"] for item in text_payload["phrases"] if item["id"] == "continuous"
    )
    records: list[dict[str, object]] = []

    for mode in ("missing-model", "hash-mismatch", "missing-config"):
        _production_guard(args.baseline_kernel_oom)
        variant = _startup_assets(assets, failure_assets, mode)
        output = Path(tempfile.mkdtemp(prefix=f"{mode}-", dir=failure_output))
        started = time.perf_counter()
        result = _run(
            _base(f"bmo-p8-piper-failure-{mode}", variant, output)
            + [
                "python",
                "-m",
                "bmo_piper.worker",
                "--manifest",
                "/assets/PIPER_ASSET_MANIFEST.json",
                "--output-root",
                "/output",
            ]
        )
        records.append(
            {
                "mode": mode,
                "expected_failure_observed": result.returncode != 0,
                "exit_code": result.returncode,
                "expected_exit_code": 1,
                "elapsed_seconds": time.perf_counter() - started,
                "stderr_tail": result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "",
                "output_file_count": sum(path.is_file() for path in output.rglob("*")),
            }
        )
        _production_guard(args.baseline_kernel_oom)

    request_modes = (
        "invalid-speaker-id",
        "invalid-speaker-name",
        "malformed-input",
        "empty-input",
        "invalid-output-path",
        "read-only-filesystem",
        "synthesis-timeout",
    )
    for mode in request_modes:
        _production_guard(args.baseline_kernel_oom)
        output = Path(tempfile.mkdtemp(prefix=f"{mode}-", dir=failure_output))
        command = _base(
            f"bmo-p8-piper-failure-{mode}",
            assets,
            output,
            read_only_output=mode == "read-only-filesystem",
        ) + [
            "python",
            "-m",
            "bmo_piper.failure_probe",
            "--manifest",
            "/assets/PIPER_ASSET_MANIFEST.json",
            "--output-root",
            "/output",
            "--mode",
            mode,
            "--text",
            continuous if mode == "synthesis-timeout" else "Hi! BMO is ready to help.",
        ]
        result = _run(command, timeout=40)
        try:
            detail = json.loads(result.stdout.strip().splitlines()[-1])
        except (IndexError, ValueError):
            detail = {"expected_failure_observed": False, "parse_error": True}
        records.append(
            {
                "mode": mode,
                "exit_code": result.returncode,
                "expected_exit_code": 0,
                "container_elapsed_seconds": detail.get("elapsed_seconds"),
                "expected_failure_observed": detail.get("expected_failure_observed"),
                "worker_returncode": detail.get("worker_returncode"),
                "worker_running_after": detail.get("worker_running_after"),
                "files_before": detail.get("files_before"),
                "files_after": detail.get("files_after"),
                "sanitized_error": detail.get("sanitized_error"),
            }
        )
        _production_guard(args.baseline_kernel_oom)

    passed = all(
        record.get("expected_failure_observed") is True
        and record.get("exit_code") == record.get("expected_exit_code")
        for record in records
    )
    payload = {
        "schema_version": 1,
        "passed": passed,
        "records": records,
        "candidate_containers_after": _run(
            ["docker", "ps", "-aq", "--filter", "name=bmo-p8-piper-failure-"]
        ).stdout.split(),
    }
    args.results.parent.mkdir(parents=True, exist_ok=True)
    args.results.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return 0 if passed and not payload["candidate_containers_after"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

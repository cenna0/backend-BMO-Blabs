from __future__ import annotations

from pathlib import Path
import argparse
import json
import os
import sys
import time

from .process import PersistentWorker, WorkerError


MODES = {
    "invalid-speaker-id",
    "invalid-speaker-name",
    "malformed-input",
    "empty-input",
    "invalid-output-path",
    "read-only-filesystem",
    "synthesis-timeout",
}


def _file_count(root: Path) -> int:
    return sum(path.is_file() for path in root.rglob("*"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--mode", choices=sorted(MODES), required=True)
    parser.add_argument("--text", default="Hi! BMO is ready to help.")
    args = parser.parse_args()
    output_root = args.output_root.resolve(strict=True)
    payload: dict[str, object] = {
        "operation": "synthesize",
        "request_id": f"failure-{args.mode}",
        "text": args.text,
        "output_path": f"{args.mode}.wav",
        "speaker_name": "prudence",
        "speaker_id": 0,
    }
    if args.mode == "invalid-speaker-id":
        payload["speaker_id"] = 1
    elif args.mode == "invalid-speaker-name":
        payload["speaker_name"] = "spike"
    elif args.mode == "malformed-input":
        payload["text"] = "hello\u0000world"
    elif args.mode == "empty-input":
        payload["text"] = ""
    elif args.mode == "invalid-output-path":
        payload["output_path"] = "../escape.wav"
    elif args.mode == "read-only-filesystem":
        payload["output_path"] = "readonly.wav"
    before_files = _file_count(output_root)
    started = time.perf_counter()
    worker = PersistentWorker(
        [
            sys.executable,
            "-m",
            "bmo_piper.worker",
            "--manifest",
            str(args.manifest),
            "--output-root",
            str(output_root),
        ],
        cleanup_root=output_root,
    )
    if args.mode == "synthesis-timeout":
        worker.timeout_seconds = 0.001
    error = None
    try:
        worker.request(payload)
    except WorkerError as caught:
        error = str(caught)
    finally:
        worker.close()
    result = {
        "mode": args.mode,
        "expected_failure_observed": error is not None,
        "sanitized_error": error,
        "elapsed_seconds": time.perf_counter() - started,
        "worker_returncode": worker.returncode,
        "worker_running_after": worker.returncode is None,
        "files_before": before_files,
        "files_after": _file_count(output_root),
        "pid": os.getpid(),
    }
    print(json.dumps(result, sort_keys=True))
    return 0 if error is not None and worker.returncode is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())

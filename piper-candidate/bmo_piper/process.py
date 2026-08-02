from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any
import json
import os
import select
import signal
import subprocess
import time
from pathlib import Path


class WorkerError(RuntimeError):
    pass


def _process_group_exists(process_group: int) -> bool:
    try:
        os.killpg(process_group, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def terminate_process_group(
    process: subprocess.Popen[Any], *, grace_seconds: float = 2.0
) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    deadline = time.monotonic() + grace_seconds
    while _process_group_exists(process.pid) and time.monotonic() < deadline:
        time.sleep(0.02)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass


class PersistentWorker:
    def __init__(
        self,
        command: Sequence[str],
        *,
        timeout_seconds: float = 120,
        cleanup_root: Path | None = None,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.cleanup_root = cleanup_root.resolve(strict=True) if cleanup_root else None
        self.process = subprocess.Popen(
            list(command),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
        try:
            self.ready = self._read(max(timeout_seconds, 2.0))
        except BaseException:
            self._terminate()
            raise
        if self.ready.get("event") != "ready":
            self._terminate()
            raise WorkerError("worker did not become ready")

    @property
    def pid(self) -> int:
        return self.process.pid

    @property
    def returncode(self) -> int | None:
        return self.process.poll()

    def _read(self, timeout: float) -> dict[str, Any]:
        if self.process.stdout is None:
            raise WorkerError("worker stdout unavailable")
        readable, _, _ = select.select([self.process.stdout], [], [], timeout)
        if not readable:
            self._terminate()
            raise WorkerError("worker timeout")
        line = self.process.stdout.readline()
        if not line:
            self._terminate()
            raise WorkerError("worker exited without response")
        try:
            response = json.loads(line)
        except ValueError as error:
            self._terminate()
            raise WorkerError("worker returned malformed JSON") from error
        if not isinstance(response, dict):
            self._terminate()
            raise WorkerError("worker response is not an object")
        return response

    def request(self, payload: Mapping[str, object]) -> dict[str, Any]:
        if self.process.poll() is not None or self.process.stdin is None:
            raise WorkerError("worker is not running")
        encoded = json.dumps(dict(payload), separators=(",", ":"))
        if len(encoded.encode("utf-8")) > 16384:
            raise WorkerError("worker request is too large")
        self.process.stdin.write(encoded + "\n")
        self.process.stdin.flush()
        try:
            response = self._read(self.timeout_seconds)
        except WorkerError:
            self._cleanup_request_outputs(payload)
            raise
        if response.get("event") == "error":
            self._cleanup_request_outputs(payload)
            raise WorkerError(str(response.get("error") or "worker error"))
        return response

    def _cleanup_request_outputs(self, payload: Mapping[str, object]) -> None:
        raw_path = payload.get("output_path")
        if self.cleanup_root is None or not isinstance(raw_path, str):
            return
        requested = Path(raw_path)
        candidate = (
            requested.resolve()
            if requested.is_absolute()
            else (self.cleanup_root / requested).resolve()
        )
        if candidate != self.cleanup_root and self.cleanup_root not in candidate.parents:
            return
        for path in (candidate, candidate.with_name(candidate.name + ".part")):
            try:
                if path.is_file() and not path.is_symlink():
                    path.unlink()
            except OSError:
                pass

    def _terminate(self) -> None:
        terminate_process_group(self.process)

    def close(self) -> None:
        if self.process.poll() is not None:
            self._terminate()
            return
        try:
            if self.process.stdin is not None:
                self.process.stdin.write('{"operation":"shutdown"}\n')
                self.process.stdin.flush()
            self.process.wait(timeout=2)
        except (BrokenPipeError, OSError, subprocess.TimeoutExpired):
            self._terminate()

    def __enter__(self) -> "PersistentWorker":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

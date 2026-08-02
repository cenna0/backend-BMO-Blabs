#!/usr/bin/env python3
from __future__ import annotations

import ctypes
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import time
from typing import Sequence


UVICORN_COMMAND = (
    sys.executable,
    "-m",
    "uvicorn",
    "app.main:create_app",
    "--factory",
    "--host",
    "0.0.0.0",
    "--port",
    "8001",
)
DEFAULT_TEMP_ROOT = Path("/opt/bmo/temp/tts")
DEFAULT_GRACE_SECONDS = 8.0
_PR_SET_CHILD_SUBREAPER = 36


def _enable_child_subreaper() -> None:
    try:
        ctypes.CDLL(None, use_errno=True).prctl(_PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0)
    except (AttributeError, OSError):
        pass


def _process_parents(proc_root: Path = Path("/proc")) -> dict[int, int]:
    parents: dict[int, int] = {}
    try:
        entries = tuple(proc_root.iterdir())
    except OSError:
        return parents
    for entry in entries:
        if not entry.name.isdigit():
            continue
        try:
            status_text = (entry / "status").read_text(encoding="utf-8", errors="replace")
            ppid_line = next(line for line in status_text.splitlines() if line.startswith("PPid:"))
            parents[int(entry.name)] = int(ppid_line.split(":", 1)[1].strip())
        except (OSError, StopIteration, ValueError):
            continue
    return parents


def _descendants(root_pid: int) -> set[int]:
    parents = _process_parents()
    found: set[int] = set()
    frontier = {root_pid}
    while frontier:
        children = {
            pid
            for pid, parent_pid in parents.items()
            if parent_pid in frontier and pid not in found and pid != root_pid
        }
        found.update(children)
        frontier = children
    return found


def _process_exists(pid: int) -> bool:
    return Path(f"/proc/{pid}").exists()


def _signal_descendants(pids: set[int], sig: signal.Signals) -> None:
    own_group = os.getpgrp()
    signalled_groups: set[int] = set()
    for pid in sorted(pids, reverse=True):
        if not _process_exists(pid):
            continue
        try:
            process_group = os.getpgid(pid)
            if process_group != own_group and process_group not in signalled_groups:
                os.killpg(process_group, sig)
                signalled_groups.add(process_group)
                continue
        except (OSError, ProcessLookupError):
            pass
        try:
            os.kill(pid, sig)
        except (OSError, ProcessLookupError):
            pass


def _reap_adopted(exclude_pid: int) -> None:
    while True:
        try:
            pid, _status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if pid == 0:
            return
        if pid == exclude_pid:
            return


def _cleanup_request_directories(temp_root: Path) -> None:
    try:
        if not temp_root.is_absolute() or temp_root.is_symlink():
            return
        resolved_root = temp_root.resolve(strict=True)
        if not stat.S_ISDIR(resolved_root.lstat().st_mode):
            return
        entries = tuple(resolved_root.iterdir())
    except OSError:
        return
    for entry in entries:
        if not entry.name.startswith("bmo-tts-"):
            continue
        try:
            if entry.is_symlink() or not stat.S_ISDIR(entry.lstat().st_mode):
                continue
            if entry.resolve(strict=True).parent != resolved_root:
                continue
            shutil.rmtree(entry)
        except OSError:
            continue


def run_supervised(
    command: Sequence[str],
    *,
    temp_root: Path = DEFAULT_TEMP_ROOT,
    grace_seconds: float = DEFAULT_GRACE_SECONDS,
    poll_seconds: float = 0.05,
) -> int:
    if not command or grace_seconds <= 0 or poll_seconds <= 0:
        raise ValueError("invalid supervisor configuration")
    _enable_child_subreaper()
    received_signal: list[signal.Signals] = []

    def request_shutdown(signum: int, _frame) -> None:
        if not received_signal:
            received_signal.append(signal.Signals(signum))

    previous_handlers = {
        current_signal: signal.signal(current_signal, request_shutdown)
        for current_signal in (signal.SIGTERM, signal.SIGINT)
    }
    child = subprocess.Popen(
        tuple(command),
        stdin=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )
    try:
        while not received_signal:
            returncode = child.poll()
            if returncode is not None:
                _cleanup_request_directories(temp_root)
                return returncode
            time.sleep(poll_seconds)

        tracked = _descendants(os.getpid()) | {child.pid}
        _signal_descendants(tracked, signal.SIGTERM)
        deadline = time.monotonic() + grace_seconds
        while time.monotonic() < deadline:
            tracked.update(_descendants(os.getpid()))
            if child.poll() is not None:
                _reap_adopted(child.pid)
            if not any(_process_exists(pid) for pid in tracked):
                break
            time.sleep(poll_seconds)

        remaining = {pid for pid in tracked | _descendants(os.getpid()) if _process_exists(pid)}
        if remaining:
            print("audio service shutdown required bounded child escalation", file=sys.stderr)
            _signal_descendants(remaining, signal.SIGKILL)
        try:
            child.wait(timeout=1.0)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=1.0)

        reap_deadline = time.monotonic() + 1.0
        while time.monotonic() < reap_deadline:
            _reap_adopted(child.pid)
            if not any(_process_exists(pid) for pid in tracked):
                break
            time.sleep(poll_seconds)
        _cleanup_request_directories(temp_root)
        return 0
    finally:
        for current_signal, previous_handler in previous_handlers.items():
            signal.signal(current_signal, previous_handler)


def main() -> int:
    return run_supervised(UVICORN_COMMAND)


if __name__ == "__main__":
    raise SystemExit(main())

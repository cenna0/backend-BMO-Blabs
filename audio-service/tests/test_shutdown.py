from __future__ import annotations

import multiprocessing
import os
from pathlib import Path
import signal
import sys
import time

import pytest

from scripts import audio_service_entrypoint


def write_script(path: Path, source: str) -> Path:
    path.write_text(source, encoding="utf-8")
    return path


def wait_for_file(path: Path, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while not path.exists() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert path.exists()


def process_exists(pid: int) -> bool:
    return Path(f"/proc/{pid}").exists()


def run_supervisor(command: tuple[str, ...], temp_root: str, grace_seconds: float) -> None:
    raise SystemExit(
        audio_service_entrypoint.run_supervised(
            command,
            temp_root=Path(temp_root),
            grace_seconds=grace_seconds,
            poll_seconds=0.01,
        ),
    )


def start_supervisor(command: tuple[str, ...], temp_root: Path, grace_seconds: float = 0.3):
    process = multiprocessing.get_context("fork").Process(
        target=run_supervisor,
        args=(command, str(temp_root), grace_seconds),
    )
    process.start()
    return process


def test_runtime_entrypoint_uses_only_the_fixed_uvicorn_command():
    assert audio_service_entrypoint.UVICORN_COMMAND == (
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


def test_container_installs_native_pid1_before_python_supervisor():
    dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text(
        encoding="utf-8",
    )

    assert "tini=0.19.0-1+b3" in dockerfile
    assert 'ENTRYPOINT ["/usr/bin/tini", "--"]' in dockerfile
    assert 'CMD ["python", "scripts/audio_service_entrypoint.py"]' in dockerfile


def test_supervisor_forwards_sigterm_and_exits_cleanly_for_cooperative_child(tmp_path):
    pid_file = tmp_path / "child.pid"
    child = write_script(
        tmp_path / "cooperative.py",
        f"""
import os
from pathlib import Path
import signal
import time
Path({str(pid_file)!r}).write_text(str(os.getpid()), encoding='utf-8')
signal.signal(signal.SIGTERM, lambda *_args: raise_exit())
def raise_exit():
    raise SystemExit(0)
while True:
    time.sleep(0.1)
""",
    )
    supervisor = start_supervisor((sys.executable, str(child)), tmp_path)
    wait_for_file(pid_file)
    child_pid = int(pid_file.read_text(encoding="utf-8"))

    started = time.monotonic()
    os.kill(supervisor.pid, signal.SIGTERM)
    supervisor.join(timeout=2)

    assert supervisor.exitcode == 0
    assert time.monotonic() - started < 1
    assert not process_exists(child_pid)


def test_supervisor_bounds_uninterruptible_child_and_detached_descendant(tmp_path):
    child_pid_file = tmp_path / "child.pid"
    grandchild_pid_file = tmp_path / "grandchild.pid"
    grandchild = write_script(
        tmp_path / "grandchild.py",
        """
import os
from pathlib import Path
import signal
import sys
import time
Path(sys.argv[1]).write_text(str(os.getpid()), encoding='utf-8')
signal.signal(signal.SIGTERM, signal.SIG_IGN)
while True:
    time.sleep(0.1)
""",
    )
    child = write_script(
        tmp_path / "uninterruptible.py",
        f"""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
Path({str(child_pid_file)!r}).write_text(str(os.getpid()), encoding='utf-8')
subprocess.Popen(
    [sys.executable, {str(grandchild)!r}, {str(grandchild_pid_file)!r}],
    start_new_session=True,
)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
while True:
    time.sleep(0.1)
""",
    )
    supervisor = start_supervisor((sys.executable, str(child)), tmp_path, grace_seconds=0.2)
    wait_for_file(child_pid_file)
    wait_for_file(grandchild_pid_file)
    child_pid = int(child_pid_file.read_text(encoding="utf-8"))
    grandchild_pid = int(grandchild_pid_file.read_text(encoding="utf-8"))

    started = time.monotonic()
    os.kill(supervisor.pid, signal.SIGTERM)
    supervisor.join(timeout=2)

    assert supervisor.exitcode == 0
    assert time.monotonic() - started < 1
    assert not process_exists(child_pid)
    assert not process_exists(grandchild_pid)


def test_supervisor_removes_only_request_scoped_temp_directories(tmp_path):
    request_dir = tmp_path / "bmo-tts-stale"
    unrelated = tmp_path / "operator-evidence"
    request_dir.mkdir()
    unrelated.mkdir()
    (request_dir / "partial.wav").write_bytes(b"partial")
    (unrelated / "keep.txt").write_text("keep", encoding="utf-8")
    pid_file = tmp_path / "cleanup.pid"
    child = write_script(
        tmp_path / "cleanup_child.py",
        f"""
import os
from pathlib import Path
import signal
import time
Path({str(pid_file)!r}).write_text(str(os.getpid()), encoding='utf-8')
signal.signal(signal.SIGTERM, lambda *_args: raise_exit())
def raise_exit():
    raise SystemExit(0)
while True:
    time.sleep(0.1)
""",
    )
    supervisor = start_supervisor((sys.executable, str(child)), tmp_path)
    wait_for_file(pid_file)

    os.kill(supervisor.pid, signal.SIGTERM)
    supervisor.join(timeout=2)

    assert supervisor.exitcode == 0
    assert not request_dir.exists()
    assert (unrelated / "keep.txt").read_text(encoding="utf-8") == "keep"


@pytest.mark.parametrize(
    "phase",
    [
        "model-loading",
        "warm-up",
        "kokoro",
        "rvc-inference",
        "ffmpeg",
        "fallback",
    ],
)
def test_supervisor_stops_cleanly_during_pipeline_phase(tmp_path, phase):
    marker = tmp_path / f"{phase}.started"
    child = write_script(
        tmp_path / f"{phase}.py",
        f"""
from pathlib import Path
import signal
import time
Path({str(marker)!r}).write_text('started', encoding='utf-8')
signal.signal(signal.SIGTERM, lambda *_args: raise_exit())
def raise_exit():
    raise SystemExit(0)
while True:
    time.sleep(0.1)
""",
    )
    supervisor = start_supervisor((sys.executable, str(child)), tmp_path)
    wait_for_file(marker)

    started = time.monotonic()
    os.kill(supervisor.pid, signal.SIGTERM)
    supervisor.join(timeout=2)

    assert supervisor.exitcode == 0
    assert time.monotonic() - started < 1

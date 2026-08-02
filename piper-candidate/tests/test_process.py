import json
import os
import sys
import time
from pathlib import Path

import pytest

from bmo_piper.process import PersistentWorker, WorkerError


def write_worker(path: Path, *, sleep: bool = False, write_partial: bool = False) -> None:
    delay = "import time; time.sleep(2)" if sleep else ""
    partial = "open(request['output_path'] + '.part', 'wb').write(b'partial')" if write_partial else "pass"
    path.write_text(
        "\n".join(
            [
                "import json, sys",
                "print(json.dumps({'event':'ready','model_load_count':1,'load_seconds':0.01}), flush=True)",
                "for line in sys.stdin:",
                "    request = json.loads(line)",
                f"    {partial}",
                f"    {delay}" if delay else "    pass",
                "    if request.get('operation') == 'shutdown': break",
                "    print(json.dumps({'event':'result','request_id':request['request_id'],'model_load_count':1}), flush=True)",
            ]
        ),
        encoding="utf-8",
    )


def test_persistent_worker_loads_once_for_multiple_requests(tmp_path):
    script = tmp_path / "worker.py"
    write_worker(script)
    worker = PersistentWorker([sys.executable, str(script)], timeout_seconds=1)
    try:
        assert worker.ready["model_load_count"] == 1
        assert worker.request({"request_id": "one"})["model_load_count"] == 1
        assert worker.request({"request_id": "two"})["model_load_count"] == 1
        assert worker.pid > 0
    finally:
        worker.close()

    assert worker.returncode == 0


def test_persistent_worker_timeout_terminates_child(tmp_path):
    script = tmp_path / "worker.py"
    write_worker(script, sleep=True)
    worker = PersistentWorker([sys.executable, str(script)], timeout_seconds=0.1)

    with pytest.raises(WorkerError, match="timeout"):
        worker.request({"request_id": "slow"})

    assert worker.returncode is not None


def test_persistent_worker_timeout_removes_scoped_partial_output(tmp_path):
    script = tmp_path / "worker.py"
    write_worker(script, sleep=True, write_partial=True)
    worker = PersistentWorker(
        [sys.executable, str(script)], timeout_seconds=0.1, cleanup_root=tmp_path
    )

    with pytest.raises(WorkerError, match="timeout"):
        worker.request({"request_id": "slow", "output_path": str(tmp_path / "slow.wav")})

    assert not (tmp_path / "slow.wav").exists()
    assert not (tmp_path / "slow.wav.part").exists()


def test_persistent_worker_timeout_terminates_process_group(tmp_path):
    script = tmp_path / "worker.py"
    pid_file = tmp_path / "grandchild.pid"
    script.write_text(
        "\n".join(
            [
                "import json, subprocess, sys, time",
                "child_code = 'import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)'",
                "child = subprocess.Popen([sys.executable, '-c', child_code])",
                f"open({str(pid_file)!r}, 'w').write(str(child.pid))",
                "print(json.dumps({'event':'ready','model_load_count':1}), flush=True)",
                "for line in sys.stdin:",
                "    time.sleep(60)",
            ]
        ),
        encoding="utf-8",
    )
    worker = PersistentWorker([sys.executable, str(script)], timeout_seconds=0.1)
    grandchild_pid = int(pid_file.read_text(encoding="ascii"))

    with pytest.raises(WorkerError, match="timeout"):
        worker.request({"request_id": "slow"})

    for _ in range(50):
        try:
            os.kill(grandchild_pid, 0)
        except ProcessLookupError:
            break
        status = Path(f"/proc/{grandchild_pid}/status")
        if status.is_file() and "State:\tZ" in status.read_text(encoding="ascii"):
            break
        time.sleep(0.02)
    else:
        pytest.fail("grandchild survived worker timeout")

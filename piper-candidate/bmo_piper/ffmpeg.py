from __future__ import annotations

from pathlib import Path
from typing import Callable
import subprocess
import time

from .shutdown import ShutdownRequested
from .process import terminate_process_group


class FfmpegError(RuntimeError):
    pass


Runner = Callable[..., subprocess.CompletedProcess[str]]


def _run_process_group(command: list[str], timeout_seconds: float) -> subprocess.CompletedProcess[str]:
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout_seconds)
    except BaseException:
        terminate_process_group(process)
        raise
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def convert_wav_to_mp3(
    input_wav: Path,
    output_mp3: Path,
    *,
    runner: Runner | None = None,
    timeout_seconds: float = 30,
) -> float:
    if not input_wav.is_file() or output_mp3.exists():
        raise FfmpegError("invalid conversion path")
    command = [
        "ffmpeg",
        "-nostdin",
        "-y",
        "-v",
        "error",
        "-i",
        str(input_wav),
        "-ac",
        "1",
        "-ar",
        "24000",
        "-b:a",
        "96k",
        str(output_mp3),
    ]
    started = time.perf_counter()
    try:
        if runner is None:
            result = _run_process_group(command, timeout_seconds)
        else:
            result = runner(
                command,
                capture_output=True,
                text=True,
                check=False,
                timeout=timeout_seconds,
            )
    except ShutdownRequested:
        output_mp3.unlink(missing_ok=True)
        raise
    except subprocess.TimeoutExpired as error:
        output_mp3.unlink(missing_ok=True)
        raise FfmpegError("FFmpeg timeout") from error
    if result.returncode != 0 or not output_mp3.is_file() or output_mp3.stat().st_size <= 0:
        output_mp3.unlink(missing_ok=True)
        raise FfmpegError("FFmpeg conversion failed")
    return time.perf_counter() - started

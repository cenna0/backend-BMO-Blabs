from __future__ import annotations

from pathlib import Path
from typing import Callable
import json
import subprocess
import time

from app.config import Settings


Runner = Callable[..., subprocess.CompletedProcess[str]]


class FfmpegConverter:
    def __init__(self, settings: Settings, runner: Runner | None = None) -> None:
        self._settings = settings
        self._runner = runner or subprocess.run
        self._available: bool | None = None

    @property
    def available(self) -> bool:
        if self._available is None:
            try:
                result = self._runner(
                    [self._settings.ffmpeg_binary, "-version"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self._available = result.returncode == 0
            except OSError:
                self._available = False
        return self._available

    @property
    def ready(self) -> bool:
        return self._available is True

    def warm_up(self) -> None:
        if not self.available:
            raise RuntimeError("ffmpeg is unavailable")

    def convert_wav_to_mp3(self, input_wav: Path, output_mp3: Path) -> float:
        command = [
            self._settings.ffmpeg_binary,
            "-y",
            "-v",
            "error",
            "-i",
            str(input_wav),
            "-ac",
            "1",
            "-ar",
            str(self._settings.output_mp3_sample_rate),
            "-b:a",
            self._settings.output_mp3_bitrate,
            str(output_mp3),
        ]
        started = time.perf_counter()
        result = self._runner(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {str(result.stderr)[:300]}")
        if not output_mp3.is_file() or output_mp3.stat().st_size <= 0:
            raise RuntimeError("ffmpeg produced no MP3 output")
        return round(time.perf_counter() - started, 3)


def probe_audio(path: Path, ffprobe_binary: str = "ffprobe") -> dict[str, object]:
    result = subprocess.run(
        [
            ffprobe_binary,
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,sample_rate,channels,bit_rate,duration",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr[:300]}")
    data = json.loads(result.stdout)
    streams = data.get("streams") or []
    if not streams:
        raise RuntimeError("ffprobe found no audio stream")
    stream = streams[0]
    return {
        "codec": stream.get("codec_name"),
        "sample_rate": int(stream.get("sample_rate") or 0),
        "channels": int(stream.get("channels") or 0),
        "bit_rate": int(float(stream.get("bit_rate") or 0)),
        "duration": float(stream.get("duration") or 0.0),
    }

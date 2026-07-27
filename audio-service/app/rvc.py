from __future__ import annotations

from pathlib import Path
import os
import shlex
import subprocess
import time

from app.config import Settings


RVC_MODEL_REPO = "Freaky98/CGO-adventure-time-BMO-rvc-v2-420e"
RVC_MODEL_REVISION = "82a8bc529bd41b930589188ead30f073d4f99fc0"
RVC_MODEL_ARCHIVE = "CGO-adventure-time-BMO-rvc-v2-420e.zip"
RVC_MODEL_EXPECTED_SIZE = 63_780_149
RVC_MODEL_EXPECTED_SHA256 = "dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0"
RVC_RELATIVE_DIR = Path("rvc/bmo")


class RvcCommandConverter:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.error: str | None = None

    @property
    def available(self) -> bool:
        if not self._settings.rvc_enabled:
            self.error = "RVC disabled"
            return False
        if self._settings.rvc_model_path is None or not self._settings.rvc_model_path.is_file():
            self.error = "RVC model file unavailable"
            return False
        if not self._settings.rvc_infer_command:
            self.error = "RVC inference command unavailable"
            return False
        self.error = None
        return True

    def convert(self, input_wav: Path, output_wav: Path) -> float:
        if not self.available:
            raise RuntimeError(self.error or "RVC unavailable")
        base_command = shlex.split(
            self._settings.rvc_infer_command or "",
            posix=os.name != "nt",
        )
        command = [
            *base_command,
            "-m",
            str(self._settings.rvc_model_path),
            "-i",
            str(input_wav),
            "-o",
            str(output_wav),
            "-fu",
            str(self._settings.rvc_f0_up_key),
            "-fm",
            self._settings.rvc_f0_method,
        ]
        if self._settings.rvc_index_path:
            command.extend(["-if", str(self._settings.rvc_index_path)])
        started = time.perf_counter()
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise RuntimeError(f"RVC failed: {result.stderr[:300]}")
        if not output_wav.is_file() or output_wav.stat().st_size <= 0:
            raise RuntimeError("RVC produced no WAV output")
        return round(time.perf_counter() - started, 3)

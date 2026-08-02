from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import math
import stat

import numpy as np
import soundfile as sf


class AudioValidationError(RuntimeError):
    pass


@dataclass(frozen=True)
class WavMetadata:
    sample_rate: int
    channels: int
    frames: int
    duration_seconds: float
    format: str
    subtype: str
    peak_amplitude: float


def _regular_file(path: Path, *, description: str) -> None:
    try:
        mode = path.lstat().st_mode
    except OSError as error:
        raise AudioValidationError(f"{description} is unavailable") from error
    if not stat.S_ISREG(mode):
        raise AudioValidationError(f"{description} is not a regular file")


def _wav_duration(path: Path) -> float:
    try:
        with sf.SoundFile(path, mode="r") as audio:
            if audio.samplerate <= 0 or audio.frames <= 0:
                raise AudioValidationError("WAV duration is not positive")
            return audio.frames / audio.samplerate
    except AudioValidationError:
        raise
    except Exception as error:
        raise AudioValidationError("WAV is not parseable") from error


def validate_rvc_wav(
    input_wav: Path,
    output_wav: Path,
    *,
    approved_dir: Path,
    max_file_bytes: int = 64 * 1024 * 1024,
) -> WavMetadata:
    _regular_file(input_wav, description="input WAV")
    _regular_file(output_wav, description="RVC WAV")
    if output_wav.suffix.lower() != ".wav":
        raise AudioValidationError("RVC output is not a WAV path")
    try:
        approved = approved_dir.resolve(strict=True)
        parent = output_wav.parent.resolve(strict=True)
    except OSError as error:
        raise AudioValidationError("RVC output directory is unavailable") from error
    if parent != approved:
        raise AudioValidationError("RVC output escaped the approved directory")

    size = output_wav.stat().st_size
    if size <= 0 or size > max_file_bytes:
        raise AudioValidationError("RVC WAV size is invalid")

    input_duration = _wav_duration(input_wav)
    peak = 0.0
    try:
        with sf.SoundFile(output_wav, mode="r") as audio:
            if audio.format != "WAV":
                raise AudioValidationError("RVC output is not WAV")
            if audio.subtype not in {"PCM_16", "PCM_24", "PCM_32", "FLOAT", "DOUBLE"}:
                raise AudioValidationError("RVC WAV sample format is unsupported")
            if audio.channels not in {1, 2}:
                raise AudioValidationError("RVC WAV channel count is invalid")
            if not 8_000 <= audio.samplerate <= 96_000:
                raise AudioValidationError("RVC WAV sample rate is invalid")
            if audio.frames <= 0:
                raise AudioValidationError("RVC WAV duration is not positive")
            duration = audio.frames / audio.samplerate
            if not 0.5 <= duration / input_duration <= 2.0:
                raise AudioValidationError("RVC WAV duration is unreasonable")
            for block in audio.blocks(blocksize=65_536, dtype="float32", always_2d=True):
                if not np.isfinite(block).all():
                    raise AudioValidationError("RVC WAV samples are not finite")
                if block.size:
                    peak = max(peak, float(np.max(np.abs(block))))
            if not math.isfinite(peak) or peak > 2.0:
                raise AudioValidationError("RVC WAV amplitude is pathological")
            return WavMetadata(
                sample_rate=audio.samplerate,
                channels=audio.channels,
                frames=audio.frames,
                duration_seconds=duration,
                format=audio.format,
                subtype=audio.subtype,
                peak_amplitude=peak,
            )
    except AudioValidationError:
        raise
    except Exception as error:
        raise AudioValidationError("RVC WAV is not parseable") from error


def _target_bitrate(value: str) -> int:
    normalized = value.strip().lower()
    if normalized.endswith("k"):
        return int(normalized[:-1]) * 1_000
    return int(normalized)


def validate_mp3_metadata(
    metadata: dict[str, object],
    *,
    expected_sample_rate: int,
    expected_bitrate: str,
) -> None:
    try:
        codec = str(metadata["codec"])
        sample_rate = int(metadata["sample_rate"])
        channels = int(metadata["channels"])
        bitrate = int(metadata["bit_rate"])
        duration = float(metadata["duration"])
        target_bitrate = _target_bitrate(expected_bitrate)
    except (KeyError, TypeError, ValueError) as error:
        raise AudioValidationError("MP3 metadata is invalid") from error
    if codec != "mp3":
        raise AudioValidationError("output codec is not MP3")
    if sample_rate != expected_sample_rate:
        raise AudioValidationError("MP3 sample rate is incompatible")
    if channels != 1:
        raise AudioValidationError("MP3 must be mono")
    if not math.isfinite(duration) or duration <= 0:
        raise AudioValidationError("MP3 duration is invalid")
    if not int(target_bitrate * 0.8) <= bitrate <= int(target_bitrate * 1.2):
        raise AudioValidationError("MP3 bitrate is incompatible")

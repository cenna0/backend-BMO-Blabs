from __future__ import annotations

from pathlib import Path
from typing import Iterable
import hashlib
import json
import math
import struct
import subprocess
import wave


class AudioValidationError(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _metrics(samples: Iterable[float], sample_rate: int) -> dict[str, object]:
    values = list(samples)
    if not values:
        raise AudioValidationError("audio contains no samples")
    finite = [value for value in values if math.isfinite(value)]
    nan_inf_count = len(values) - len(finite)
    if nan_inf_count:
        raise AudioValidationError("audio contains NaN/Inf")
    peak = max(abs(value) for value in finite)
    rms = math.sqrt(sum(value * value for value in finite) / len(finite))
    dc = sum(finite) / len(finite)
    clipping = sum(abs(value) >= 0.999 for value in finite) / len(finite)
    silent = [abs(value) <= 0.01 for value in finite]
    silence_ratio = sum(silent) / len(silent)
    leading = 0
    for is_silent in silent:
        if not is_silent:
            break
        leading += 1
    trailing = 0
    for is_silent in reversed(silent):
        if not is_silent:
            break
        trailing += 1
    deltas = sorted(abs(finite[index] - finite[index - 1]) for index in range(1, len(finite)))
    p95_delta = deltas[min(len(deltas) - 1, math.ceil(0.95 * (len(deltas) - 1)))] if deltas else 0.0
    return {
        "peak_amplitude": peak,
        "rms": rms,
        "dc_offset": dc,
        "clipping_ratio": clipping,
        "silence_ratio": silence_ratio,
        "leading_silence_seconds": leading / sample_rate,
        "trailing_silence_seconds": trailing / sample_rate,
        "gross_discontinuity_p95": p95_delta,
        "nan_inf_count": nan_inf_count,
    }


def validate_wav(
    path: Path,
    *,
    expected_sample_rate: int,
    expected_duration: float | None = None,
) -> dict[str, object]:
    if not path.is_file() or path.is_symlink() or not 44 < path.stat().st_size <= 50 * 1024**2:
        raise AudioValidationError("WAV file size is invalid")
    try:
        with wave.open(str(path), "rb") as wav_file:
            channels = wav_file.getnchannels()
            width = wav_file.getsampwidth()
            rate = wav_file.getframerate()
            frames = wav_file.getnframes()
            payload = wav_file.readframes(frames)
    except (OSError, EOFError, wave.Error) as error:
        raise AudioValidationError("WAV is malformed") from error
    if channels != 1 or width != 2:
        raise AudioValidationError("WAV must be mono PCM16")
    if rate != expected_sample_rate:
        raise AudioValidationError("WAV sample rate mismatch")
    if frames <= 0 or len(payload) != frames * 2:
        raise AudioValidationError("WAV is truncated")
    duration = frames / rate
    if not 0.05 <= duration <= 180:
        raise AudioValidationError("WAV duration is unreasonable")
    integer_samples = struct.unpack(f"<{frames}h", payload)
    metrics = _metrics((value / 32768.0 for value in integer_samples), rate)
    if metrics["peak_amplitude"] <= 1e-5 or metrics["rms"] <= 1e-6:
        raise AudioValidationError("WAV is silent")
    result: dict[str, object] = {
        "codec": "pcm_s16le",
        "channels": channels,
        "sample_rate": rate,
        "sample_width": width,
        "frames": frames,
        "duration_seconds": duration,
        "file_size_bytes": path.stat().st_size,
        "sha256": _sha256(path),
        **metrics,
    }
    if expected_duration is not None and expected_duration > 0:
        result["duration_ratio"] = duration / expected_duration
    return result


def probe_audio(path: Path, *, ffprobe_binary: str = "ffprobe") -> dict[str, object]:
    result = subprocess.run(
        [
            ffprobe_binary,
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,sample_rate,channels,bit_rate,duration",
            "-show_entries",
            "format=duration,bit_rate",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    if result.returncode != 0:
        raise AudioValidationError("ffprobe failed")
    try:
        data = json.loads(result.stdout)
        stream = data["streams"][0]
        format_data = data.get("format", {})
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise AudioValidationError("ffprobe returned no audio stream") from error
    return {
        "codec": stream.get("codec_name"),
        "sample_rate": int(stream.get("sample_rate") or 0),
        "channels": int(stream.get("channels") or 0),
        "bit_rate": int(stream.get("bit_rate") or format_data.get("bit_rate") or 0),
        "duration_seconds": float(stream.get("duration") or format_data.get("duration") or 0),
    }


def validate_mp3(path: Path) -> dict[str, object]:
    if not path.is_file() or path.is_symlink() or not 100 < path.stat().st_size <= 25 * 1024**2:
        raise AudioValidationError("MP3 file size is invalid")
    probe = probe_audio(path)
    if probe["codec"] != "mp3" or probe["channels"] != 1 or probe["sample_rate"] != 24000:
        raise AudioValidationError("MP3 contract mismatch")
    if not 90000 <= int(probe["bit_rate"]) <= 100000:
        raise AudioValidationError("MP3 bitrate mismatch")
    if float(probe["duration_seconds"]) <= 0:
        raise AudioValidationError("MP3 duration is invalid")
    decoded = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", "24000", "-"],
        capture_output=True,
        check=False,
        timeout=30,
    )
    if decoded.returncode != 0 or len(decoded.stdout) < 4:
        raise AudioValidationError("MP3 decode failed")
    count = len(decoded.stdout) // 4
    samples = struct.unpack(f"<{count}f", decoded.stdout[: count * 4])
    return {
        **probe,
        "file_size_bytes": path.stat().st_size,
        "sha256": _sha256(path),
        **_metrics(samples, 24000),
    }

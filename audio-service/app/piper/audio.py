from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import wave


class PiperAudioError(ValueError):
    """Raised when Piper output does not satisfy the fixed WAV contract."""


@dataclass(frozen=True)
class PiperWavMetadata:
    sample_rate: int
    channels: int
    sample_width: int
    frames: int
    duration_seconds: float


def validate_piper_wav(
    path: Path,
    *,
    expected_sample_rate: int = 22_050,
    maximum_duration_seconds: float = 120.0,
) -> PiperWavMetadata:
    if not path.is_file() or path.is_symlink() or path.stat().st_size <= 44:
        raise PiperAudioError("Piper output is empty")
    try:
        with wave.open(str(path), "rb") as wav_file:
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            sample_rate = wav_file.getframerate()
            frames = wav_file.getnframes()
            compression = wav_file.getcomptype()
    except (OSError, EOFError, wave.Error) as error:
        raise PiperAudioError("Piper output is not a valid WAV") from error
    if compression != "NONE" or channels != 1 or sample_width != 2:
        raise PiperAudioError("Piper output is not mono PCM16")
    if sample_rate != expected_sample_rate:
        raise PiperAudioError("Piper output sample rate is invalid")
    duration_seconds = frames / sample_rate if sample_rate else 0.0
    if frames <= 0 or duration_seconds <= 0 or duration_seconds > maximum_duration_seconds:
        raise PiperAudioError("Piper output duration is invalid")
    return PiperWavMetadata(
        sample_rate=sample_rate,
        channels=channels,
        sample_width=sample_width,
        frames=frames,
        duration_seconds=round(duration_seconds, 6),
    )

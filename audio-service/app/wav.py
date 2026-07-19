from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
import io
import os
import tempfile
import wave


class WavValidationError(ValueError):
    pass


@dataclass(frozen=True)
class WavMetadata:
    sample_rate: int
    channels: int
    sample_width: int
    duration_seconds: float


def inspect_wav(data: bytes) -> WavMetadata:
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            sample_rate = wav.getframerate()
            frames = wav.getnframes()
            compression = wav.getcomptype()
    except (wave.Error, EOFError):
        raise WavValidationError("invalid wav container") from None

    if compression != "NONE":
        raise WavValidationError("compression must be PCM")
    if channels != 1:
        raise WavValidationError("channels must be mono")
    if sample_width != 2:
        raise WavValidationError("sample_width must be 16-bit PCM")
    if sample_rate != 16_000:
        raise WavValidationError("sample_rate must be 16000 Hz")

    return WavMetadata(
        sample_rate=sample_rate,
        channels=channels,
        sample_width=sample_width,
        duration_seconds=round(frames / sample_rate, 6),
    )


@contextmanager
def temporary_wav_file(data: bytes):
    fd, raw_path = tempfile.mkstemp(prefix="bmo-stt-", suffix=".wav")
    path = Path(raw_path)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        yield path
    finally:
        path.unlink(missing_ok=True)

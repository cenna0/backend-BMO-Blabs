import math
import wave
from pathlib import Path

import pytest

from bmo_piper.audio import AudioValidationError, validate_wav


def write_sine(path: Path, *, rate: int = 22050, seconds: float = 1.0) -> None:
    samples = bytearray()
    for index in range(int(rate * seconds)):
        value = int(math.sin(2 * math.pi * 440 * index / rate) * 12000)
        samples.extend(value.to_bytes(2, "little", signed=True))
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(rate)
        wav_file.writeframes(bytes(samples))


def test_validate_wav_reports_required_metrics(tmp_path):
    path = tmp_path / "voice.wav"
    write_sine(path)

    result = validate_wav(path, expected_sample_rate=22050)

    assert result["codec"] == "pcm_s16le"
    assert result["channels"] == 1
    assert result["sample_rate"] == 22050
    assert result["duration_seconds"] == pytest.approx(1.0)
    assert 0 < result["rms"] < 1
    assert 0 < result["peak_amplitude"] < 1
    assert result["nan_inf_count"] == 0
    assert result["clipping_ratio"] == 0
    assert result["sha256"]


@pytest.mark.parametrize("payload", [b"", b"not a wav"])
def test_validate_wav_rejects_malformed_files(tmp_path, payload):
    path = tmp_path / "bad.wav"
    path.write_bytes(payload)

    with pytest.raises(AudioValidationError):
        validate_wav(path, expected_sample_rate=22050)


def test_validate_wav_rejects_wrong_rate(tmp_path):
    path = tmp_path / "wrong.wav"
    write_sine(path, rate=16000)

    with pytest.raises(AudioValidationError, match="sample rate"):
        validate_wav(path, expected_sample_rate=22050)

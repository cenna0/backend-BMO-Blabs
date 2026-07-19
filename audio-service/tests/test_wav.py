import pytest

from app.wav import WavValidationError, inspect_wav
from tests.helpers import make_wav


def test_inspect_wav_accepts_16khz_mono_pcm16():
    metadata = inspect_wav(make_wav(frames=1_600))

    assert metadata.sample_rate == 16_000
    assert metadata.channels == 1
    assert metadata.sample_width == 2
    assert metadata.duration_seconds == 0.1


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"sample_rate": 8_000}, "sample_rate"),
        ({"channels": 2}, "channels"),
        ({"sample_width": 1}, "sample_width"),
    ],
)
def test_inspect_wav_rejects_non_canonical_metadata(kwargs, message):
    with pytest.raises(WavValidationError, match=message):
        inspect_wav(make_wav(**kwargs))


def test_inspect_wav_rejects_corrupt_bytes():
    with pytest.raises(WavValidationError):
        inspect_wav(b"not a wav")

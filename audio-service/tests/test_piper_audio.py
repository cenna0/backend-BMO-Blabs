import wave

import pytest

from app.piper.audio import PiperAudioError, validate_piper_wav
from tests.helpers import write_wav_file


def test_piper_wav_requires_mono_pcm16_at_22050(tmp_path):
    path = tmp_path / "valid.wav"
    write_wav_file(path, sample_rate=22_050)
    metadata = validate_piper_wav(path)
    assert metadata.sample_rate == 22_050
    assert metadata.channels == 1
    assert metadata.sample_width == 2


@pytest.mark.parametrize("kind", ["missing", "zero", "malformed"])
def test_piper_wav_rejects_missing_zero_and_malformed_output(tmp_path, kind):
    path = tmp_path / f"{kind}.wav"
    if kind == "zero":
        path.touch()
    elif kind == "malformed":
        path.write_bytes(b"not a wav")
    with pytest.raises(PiperAudioError):
        validate_piper_wav(path)


def test_piper_wav_rejects_wrong_sample_rate_and_duration(tmp_path):
    wrong_rate = tmp_path / "wrong-rate.wav"
    write_wav_file(wrong_rate, sample_rate=24_000)
    with pytest.raises(PiperAudioError, match="sample rate"):
        validate_piper_wav(wrong_rate)

    too_long = tmp_path / "too-long.wav"
    with wave.open(str(too_long), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(22_050)
        wav_file.writeframes(b"\x00\x00" * (22_050 * 121))
    with pytest.raises(PiperAudioError, match="duration"):
        validate_piper_wav(too_long)

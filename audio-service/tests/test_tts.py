from pathlib import Path

import pytest

from app.config import Settings
from app.tts import (
    TextValidationError,
    TtsEngineState,
    TtsOrchestrator,
    TtsSynthesisError,
    validate_tts_text,
)
from tests.helpers import write_wav_file


class FakePiper:
    ready = True

    def __init__(self):
        self.calls = []

    def synthesize_to_wav(self, text: str, output_path: Path) -> float:
        assert text == "Hi! BMO is ready to help."
        self.calls.append(text)
        write_wav_file(output_path, sample_rate=22_050)
        return 0.21


class FakePiperFailure:
    ready = True

    def __init__(self):
        self.calls = []

    def synthesize_to_wav(self, text: str, output_path: Path) -> float:
        self.calls.append(text)
        output_path.write_bytes(b"partial wav")
        raise RuntimeError("forced Piper worker failure")


class FakeFfmpeg:
    available = True

    def __init__(self, fail: bool = False):
        self.fail = fail
        self.inputs = []

    def convert_wav_to_mp3(self, input_wav: Path, output_mp3: Path) -> float:
        self.inputs.append(input_wav.name)
        assert input_wav.exists()
        if self.fail:
            raise RuntimeError("ffmpeg failed")
        output_mp3.write_bytes(b"fake mp3 bytes")
        return 0.33


def make_orchestrator(tmp_path, piper=None, ffmpeg=None):
    return TtsOrchestrator(
        settings=Settings(
            internal_service_token="test-internal-token",
            tts_temp_dir=tmp_path,
        ),
        piper=piper or FakePiper(),
        ffmpeg=ffmpeg or FakeFfmpeg(),
    )


def test_validate_tts_text_trims_plain_english():
    assert validate_tts_text("  Hi! BMO is ready to help.  ") == "Hi! BMO is ready to help."


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   ",
        "One. Two. Three. Four.",
        "A" * 601,
        "[BMO](https://example.com)",
    ],
)
def test_validate_tts_text_rejects_invalid_input(text):
    with pytest.raises(TextValidationError):
        validate_tts_text(text)


def test_synthesize_uses_piper_as_primary_and_cleans_temp_files(tmp_path):
    piper = FakePiper()
    result = make_orchestrator(tmp_path, piper=piper).synthesize("Hi! BMO is ready to help.")

    assert result.audio == b"fake mp3 bytes"
    assert result.engine == "piper"
    assert result.piper_seconds == 0.21
    assert piper.calls == ["Hi! BMO is ready to help."]
    assert not list(tmp_path.glob("*"))


def test_synthesize_returns_tts_failed_when_piper_fails_without_fallback_or_ffmpeg(tmp_path):
    piper = FakePiperFailure()
    ffmpeg = FakeFfmpeg()

    with pytest.raises(TtsSynthesisError, match="TTS_FAILED"):
        make_orchestrator(tmp_path, piper=piper, ffmpeg=ffmpeg).synthesize(
            "Hi! BMO is ready to help."
        )

    assert piper.calls == ["Hi! BMO is ready to help."]
    assert ffmpeg.inputs == []
    assert not list(tmp_path.glob("*"))


def test_synthesize_returns_tts_failed_when_ffmpeg_fails_and_cleans_temp_files(tmp_path):
    with pytest.raises(TtsSynthesisError):
        make_orchestrator(tmp_path, piper=FakePiper(), ffmpeg=FakeFfmpeg(fail=True)).synthesize(
            "Hi! BMO is ready to help."
        )

    assert not list(tmp_path.glob("*"))


def test_health_state_requires_piper_and_ffmpeg(tmp_path):
    orchestrator = make_orchestrator(tmp_path, piper=FakePiper())

    assert orchestrator.health_state() == TtsEngineState(
        ffmpeg_available=True,
        piper_loaded=True,
    )

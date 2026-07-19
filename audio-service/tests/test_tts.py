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


class FakeKokoro:
    ready = True

    def synthesize_to_wav(self, text: str, output_path: Path) -> float:
        assert text == "Hi! BMO is ready to help."
        write_wav_file(output_path)
        return 0.11


class FakeRvcFailure:
    available = True
    error = "forced failure"

    def convert(self, input_wav: Path, output_wav: Path) -> float:
        assert input_wav.exists()
        raise RuntimeError("forced RVC failure with no secret")


class FakeRvcSuccess:
    available = True
    error = None

    def convert(self, input_wav: Path, output_wav: Path) -> float:
        assert input_wav.exists()
        write_wav_file(output_wav)
        return 0.22


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


def make_orchestrator(tmp_path, rvc, ffmpeg=None):
    return TtsOrchestrator(
        settings=Settings(
            internal_service_token="test-internal-token",
            tts_temp_dir=tmp_path,
        ),
        kokoro=FakeKokoro(),
        ffmpeg=ffmpeg or FakeFfmpeg(),
        rvc=rvc,
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


def test_synthesize_falls_back_to_kokoro_when_rvc_fails_and_cleans_temp_files(tmp_path):
    orchestrator = make_orchestrator(tmp_path, FakeRvcFailure())

    result = orchestrator.synthesize("Hi! BMO is ready to help.", use_rvc=True)

    assert result.audio == b"fake mp3 bytes"
    assert result.rvc_applied is False
    assert result.engine == "kokoro"
    assert result.kokoro_seconds == 0.11
    assert result.rvc_seconds is None
    assert result.ffmpeg_seconds == 0.33
    assert not list(tmp_path.glob("*"))


def test_synthesize_uses_rvc_when_available_and_cleans_temp_files(tmp_path):
    ffmpeg = FakeFfmpeg()
    orchestrator = make_orchestrator(tmp_path, FakeRvcSuccess(), ffmpeg)

    result = orchestrator.synthesize("Hi! BMO is ready to help.", use_rvc=True)

    assert result.rvc_applied is True
    assert result.engine == "kokoro-rvc"
    assert result.rvc_seconds == 0.22
    assert any(name.endswith("-rvc.wav") for name in ffmpeg.inputs)
    assert not list(tmp_path.glob("*"))


def test_synthesize_returns_tts_failed_when_ffmpeg_fails_and_cleans_temp_files(tmp_path):
    orchestrator = make_orchestrator(tmp_path, FakeRvcFailure(), FakeFfmpeg(fail=True))

    with pytest.raises(TtsSynthesisError):
        orchestrator.synthesize("Hi! BMO is ready to help.", use_rvc=True)

    assert not list(tmp_path.glob("*"))


def test_health_state_is_degraded_when_rvc_unavailable_but_required_components_ready(tmp_path):
    orchestrator = make_orchestrator(tmp_path, rvc=None)

    assert orchestrator.health_state() == TtsEngineState(
        kokoro_loaded=True,
        ffmpeg_available=True,
        rvc_available=False,
        rvc_error="RVC unavailable",
    )

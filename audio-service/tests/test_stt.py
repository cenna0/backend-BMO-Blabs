from pathlib import Path

from app.config import Settings
from app.stt import (
    FasterWhisperTranscriber,
    SegmentTranscript,
    TranscriptionMetadata,
    normalize_transcription,
)


def test_normalize_transcription_combines_segments_and_language_info():
    result = normalize_transcription(
        [
            SegmentTranscript(start=0.0, end=1.0, text=" BMO, "),
            SegmentTranscript(start=1.0, end=2.0, text="tolong bantu aku. "),
        ],
        TranscriptionMetadata(
            language="id",
            language_probability=0.91,
            duration_seconds=2.0,
            duration_after_vad=2.0,
        ),
    )

    assert result.text == "BMO, tolong bantu aku."
    assert result.speech_detected is True
    assert result.language == "id"
    assert result.language_probability == 0.91


def test_normalize_transcription_marks_empty_segments_as_no_speech():
    result = normalize_transcription(
        [],
        TranscriptionMetadata(
            language="en",
            language_probability=0.5,
            duration_seconds=2.0,
            duration_after_vad=0.0,
        ),
    )

    assert result.text == ""
    assert result.speech_detected is False
    assert result.language is None
    assert result.language_probability == 0.0


def test_faster_whisper_adapter_uses_accuracy_model_config_and_hotwords():
    captured = {}

    class StubSegment:
        start = 0.0
        end = 1.0
        text = " Hello BMO "

    class StubInfo:
        language = "en"
        language_probability = 0.98
        duration = 1.0
        duration_after_vad = 1.0

    class StubWhisperModel:
        def __init__(self, *args, **kwargs):
            captured["model_args"] = args
            captured["model_kwargs"] = kwargs

        def transcribe(self, audio_path, **kwargs):
            captured["audio_path"] = audio_path
            captured["transcribe_kwargs"] = kwargs
            return iter([StubSegment()]), StubInfo()

    transcriber = FasterWhisperTranscriber(
        Settings(internal_service_token="test-internal-token"),
        model_factory=StubWhisperModel,
    )

    result = transcriber.transcribe(Path("sample.wav"))

    assert captured["model_args"] == ("medium",)
    assert captured["model_kwargs"] == {
        "device": "cpu",
        "compute_type": "int8",
        "cpu_threads": 4,
        "num_workers": 1,
    }
    assert captured["transcribe_kwargs"] == {
        "language": None,
        "task": "transcribe",
        "beam_size": 5,
        "vad_filter": True,
        "hotwords": "BMO",
    }
    assert result.text == "Hello BMO"
    assert result.speech_detected is True

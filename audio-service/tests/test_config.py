from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_settings_use_p2_whisper_defaults():
    settings = Settings(internal_service_token="test-internal-token")

    assert settings.audio_service_host == "127.0.0.1"
    assert settings.audio_service_port == 8001
    assert settings.whisper_model == "medium"
    assert settings.whisper_device == "cpu"
    assert settings.whisper_compute_type == "int8"
    assert settings.whisper_cpu_threads == 4
    assert settings.whisper_workers == 1
    assert settings.whisper_beam_size == 5
    assert settings.whisper_vad is True
    assert settings.whisper_hotwords == "BMO"
    assert settings.model_download_allowed is False
    assert settings.hf_home == Path("/opt/bmo/models/hf-cache")
    assert settings.runtime_models_root == Path("/opt/bmo/models/runtime")
    assert settings.model_manifest_path == Path("/opt/bmo/models/MODEL_MANIFEST.md")
    assert settings.whisper_model_repo == "Systran/faster-whisper-medium"
    assert settings.whisper_model_revision == "08e178d48790749d25932bbc082711ddcfdfbc4f"
    assert not hasattr(settings, "whisper_snapshot_path")


def test_settings_use_piper_tts_defaults_without_legacy_engines():
    settings = Settings(internal_service_token="test-internal-token")

    assert settings.output_mp3_sample_rate == 24_000
    assert settings.output_mp3_bitrate == "96k"
    assert settings.tts_max_characters == 600
    assert settings.tts_max_sentences == 3


def test_settings_use_fixed_piper_primary_defaults():
    settings = Settings(internal_service_token="test-internal-token")

    assert settings.tts_primary_engine == "piper"
    assert settings.piper_model == "en_GB-semaine-medium"
    assert settings.piper_speaker == "prudence"
    assert settings.piper_speaker_id == 0
    assert settings.piper_engine_revision == "f04d52c5528ac7cf2d73757f57990ff490f75005"
    assert settings.piper_voice_revision == "9f967d15e9ccdf43078586d1476ee70f314401bd"
    assert settings.piper_manifest_path == Path("/opt/bmo/models/piper/PIPER_ASSET_MANIFEST.json")
    assert settings.model_download_allowed is False


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("tts_primary_engine", "edge-tts"),
        ("piper_model", "en_US-lessac-medium"),
        ("piper_speaker", "spike"),
        ("piper_speaker_id", 1),
        ("piper_manifest_path", "/tmp/arbitrary-model.json"),
    ],
)
def test_fixed_voice_settings_reject_unapproved_overrides(field, value):
    with pytest.raises(ValidationError):
        Settings(internal_service_token="test-internal-token", **{field: value})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("whisper_model_repo", "Systran/faster-whisper-large-v3"),
        ("whisper_model_revision", "main"),
    ],
)
def test_model_identity_settings_reject_unapproved_overrides(field, value):
    with pytest.raises(ValidationError):
        Settings(
            internal_service_token="test-internal-token",
            **{field: value},
        )


def test_settings_reject_short_internal_service_token():
    with pytest.raises(ValidationError):
        Settings(internal_service_token="short")

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
    assert settings.torch_home == Path("/opt/bmo/models/torch-cache")
    assert settings.model_manifest_path == Path("/opt/bmo/models/MODEL_MANIFEST.md")


def test_settings_use_p3_tts_defaults():
    settings = Settings(internal_service_token="test-internal-token")

    assert settings.kokoro_lang_code == "a"
    assert settings.kokoro_voice == "af_heart"
    assert settings.kokoro_speed == 0.80
    assert settings.kokoro_sample_rate == 24_000
    assert settings.output_mp3_sample_rate == 24_000
    assert settings.output_mp3_bitrate == "96k"
    assert settings.tts_max_characters == 600
    assert settings.tts_max_sentences == 3
    assert settings.rvc_enabled is False
    assert settings.rvc_f0_up_key == 0
    assert settings.rvc_f0_method == "rmvpe"
    assert settings.rvc_model_repo == "Freaky98/CGO-adventure-time-BMO-rvc-v2-420e"
    assert settings.rvc_model_revision == "82a8bc529bd41b930589188ead30f073d4f99fc0"
    assert settings.rvc_model_archive == "CGO-adventure-time-BMO-rvc-v2-420e.zip"
    assert settings.rvc_model_expected_size == 63_780_149
    assert settings.rvc_model_expected_sha256 == "dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0"
    assert settings.rvc_model_path is None


def test_settings_reject_short_internal_service_token():
    with pytest.raises(ValidationError):
        Settings(internal_service_token="short")

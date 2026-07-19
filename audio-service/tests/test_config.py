import pytest
from pydantic import ValidationError

from app.config import Settings


def test_settings_use_p2_whisper_defaults():
    settings = Settings(internal_service_token="test-internal-token")

    assert settings.audio_service_host == "127.0.0.1"
    assert settings.audio_service_port == 8001
    assert settings.whisper_model == "small"
    assert settings.whisper_device == "cpu"
    assert settings.whisper_compute_type == "int8"
    assert settings.whisper_cpu_threads == 4
    assert settings.whisper_workers == 1
    assert settings.whisper_beam_size == 5
    assert settings.whisper_vad is True
    assert settings.model_download_allowed is False


def test_settings_reject_short_internal_service_token():
    with pytest.raises(ValidationError):
        Settings(internal_service_token="short")

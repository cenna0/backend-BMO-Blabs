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
    assert settings.runtime_models_root == Path("/opt/bmo/models/runtime")
    assert settings.model_manifest_path == Path("/opt/bmo/models/MODEL_MANIFEST.md")
    assert settings.whisper_model_repo == "Systran/faster-whisper-medium"
    assert settings.whisper_model_revision == "08e178d48790749d25932bbc082711ddcfdfbc4f"
    assert not hasattr(settings, "whisper_snapshot_path")


def test_settings_use_p3_tts_defaults():
    settings = Settings(internal_service_token="test-internal-token")

    assert settings.kokoro_lang_code == "a"
    assert settings.kokoro_voice == "af_heart"
    assert settings.kokoro_model_repo == "hexgrad/Kokoro-82M"
    assert settings.kokoro_model_revision == "f3ff3571791e39611d31c381e3a41a3af07b4987"
    assert not hasattr(settings, "kokoro_snapshot_path")
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
    assert settings.rvc_index_path is None
    assert settings.rvc_hubert_path is None
    assert settings.rvc_rmvpe_path is None
    assert settings.rvc_manifest_path is None
    assert settings.rvc_infer_command is None
    assert settings.rvc_device == "cpu"
    assert settings.rvc_index_rate == 0.75
    assert settings.rvc_protect == 0.33
    assert settings.rvc_rms_mix_rate == 0.25
    assert settings.rvc_cpu_threads == 4
    assert settings.rvc_timeout_seconds == 120.0


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("whisper_model_repo", "Systran/faster-whisper-large-v3"),
        ("whisper_model_revision", "main"),
        ("kokoro_model_repo", "hexgrad/Kokoro-82M-v2"),
        ("kokoro_model_revision", "main"),
        ("kokoro_voice", "af_bella"),
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


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("rvc_model_repo", "mutable/model"),
        ("rvc_model_revision", "main"),
        ("rvc_model_archive", "replacement.zip"),
        ("rvc_model_expected_size", 1),
        ("rvc_model_expected_sha256", "0" * 64),
        ("rvc_f0_method", "harvest"),
        ("rvc_device", "cuda:0"),
        ("rvc_infer_command", "python arbitrary.py"),
        ("rvc_timeout_seconds", 0),
        ("rvc_timeout_seconds", 301),
        ("rvc_index_rate", -0.01),
        ("rvc_index_rate", 1.01),
        ("rvc_protect", -0.01),
        ("rvc_protect", 0.51),
        ("rvc_rms_mix_rate", -0.01),
        ("rvc_rms_mix_rate", 1.01),
        ("rvc_cpu_threads", 0),
        ("rvc_cpu_threads", 5),
    ],
)
def test_settings_reject_unapproved_rvc_runtime_values(field, value):
    with pytest.raises(ValidationError):
        Settings(
            internal_service_token="test-internal-token",
            **{field: value},
        )


def test_settings_accept_exact_pinned_rvc_worker_command():
    settings = Settings(
        internal_service_token="test-internal-token",
        rvc_infer_command="/opt/rvc-venv/bin/python /app/scripts/rvc_infer.py",
    )

    assert settings.rvc_infer_command == (
        "/opt/rvc-venv/bin/python /app/scripts/rvc_infer.py"
    )

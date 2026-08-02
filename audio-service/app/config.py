from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    audio_service_host: str = "127.0.0.1"
    audio_service_port: int = 8001
    internal_service_token: str = Field(min_length=16)

    hf_home: Path = Path("/opt/bmo/models/hf-cache")
    torch_home: Path = Path("/opt/bmo/models/torch-cache")
    runtime_models_root: Path = Path("/opt/bmo/models/runtime")
    xdg_cache_home: Path = Path("/tmp/cache")
    model_download_allowed: bool = False
    model_manifest_path: Path = Path("/opt/bmo/models/MODEL_MANIFEST.md")

    whisper_model: str = "medium"
    whisper_model_repo: Literal["Systran/faster-whisper-medium"] = (
        "Systran/faster-whisper-medium"
    )
    whisper_model_revision: Literal["08e178d48790749d25932bbc082711ddcfdfbc4f"] = (
        "08e178d48790749d25932bbc082711ddcfdfbc4f"
    )
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_cpu_threads: int = Field(default=4, gt=0)
    whisper_workers: int = Field(default=1, gt=0)
    whisper_beam_size: int = Field(default=5, gt=0)
    whisper_vad: bool = True
    whisper_hotwords: str | None = "BMO"

    kokoro_lang_code: str = "a"
    kokoro_voice: Literal["af_heart"] = "af_heart"
    kokoro_model_repo: Literal["hexgrad/Kokoro-82M"] = "hexgrad/Kokoro-82M"
    kokoro_model_revision: Literal["f3ff3571791e39611d31c381e3a41a3af07b4987"] = (
        "f3ff3571791e39611d31c381e3a41a3af07b4987"
    )
    kokoro_sample_rate: int = Field(default=24_000, gt=0)
    kokoro_speed: float = Field(default=0.80, gt=0)

    tts_temp_dir: Path = Path("/tmp/bmo-tts")
    tts_max_characters: int = Field(default=600, gt=0)
    tts_max_sentences: int = Field(default=3, gt=0)

    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"
    output_mp3_sample_rate: int = Field(default=24_000, gt=0)
    output_mp3_bitrate: str = "96k"

    rvc_enabled: bool = False
    rvc_model_repo: Literal["Freaky98/CGO-adventure-time-BMO-rvc-v2-420e"] = (
        "Freaky98/CGO-adventure-time-BMO-rvc-v2-420e"
    )
    rvc_model_revision: Literal["82a8bc529bd41b930589188ead30f073d4f99fc0"] = (
        "82a8bc529bd41b930589188ead30f073d4f99fc0"
    )
    rvc_model_archive: Literal["CGO-adventure-time-BMO-rvc-v2-420e.zip"] = (
        "CGO-adventure-time-BMO-rvc-v2-420e.zip"
    )
    rvc_model_expected_size: Literal[63_780_149] = 63_780_149
    rvc_model_expected_sha256: Literal[
        "dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0"
    ] = "dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0"
    rvc_model_path: Path | None = None
    rvc_index_path: Path | None = None
    rvc_hubert_path: Path | None = None
    rvc_rmvpe_path: Path | None = None
    rvc_manifest_path: Path | None = None
    rvc_f0_up_key: int = Field(default=0, ge=-24, le=24)
    rvc_f0_method: Literal["rmvpe"] = "rmvpe"
    rvc_device: Literal["cpu"] = "cpu"
    rvc_index_rate: float = Field(default=0.75, ge=0.0, le=1.0)
    rvc_protect: float = Field(default=0.33, ge=0.0, le=0.5)
    rvc_rms_mix_rate: float = Field(default=0.25, ge=0.0, le=1.0)
    rvc_cpu_threads: int = Field(default=4, ge=1, le=4)
    rvc_infer_command: Literal[
        "/opt/rvc-venv/bin/python /app/scripts/rvc_infer.py"
    ] | None = None
    rvc_timeout_seconds: float = Field(default=120.0, gt=0, le=300)
    rvc_capture_limit_bytes: int = Field(default=16_384, ge=1_024, le=1_048_576)

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

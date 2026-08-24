from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


PIPER_MODEL_NAME = "en_GB-semaine-medium"
PIPER_SPEAKER_NAME = "prudence"
PIPER_SPEAKER_ID = 0
PIPER_ENGINE_REVISION = "f04d52c5528ac7cf2d73757f57990ff490f75005"
PIPER_VOICE_REVISION = "9f967d15e9ccdf43078586d1476ee70f314401bd"
PIPER_MANIFEST_PATH = Path("/opt/bmo/models/piper/PIPER_ASSET_MANIFEST.json")


class Settings(BaseSettings):
    audio_service_host: str = "127.0.0.1"
    audio_service_port: int = 8001
    internal_service_token: str = Field(min_length=16)

    hf_home: Path = Path("/opt/bmo/models/hf-cache")
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

    tts_primary_engine: Literal["piper"] = "piper"
    piper_model: Literal["en_GB-semaine-medium"] = PIPER_MODEL_NAME
    piper_speaker: Literal["prudence"] = PIPER_SPEAKER_NAME
    piper_speaker_id: int = Field(default=PIPER_SPEAKER_ID, ge=0, le=0)
    piper_engine_revision: Literal[
        "f04d52c5528ac7cf2d73757f57990ff490f75005"
    ] = PIPER_ENGINE_REVISION
    piper_voice_revision: Literal[
        "9f967d15e9ccdf43078586d1476ee70f314401bd"
    ] = PIPER_VOICE_REVISION
    piper_manifest_path: Path = PIPER_MANIFEST_PATH
    piper_worker_timeout_seconds: float = Field(default=120.0, gt=0, le=180)

    tts_temp_dir: Path = Path("/tmp/bmo-tts")
    tts_max_characters: int = Field(default=600, gt=0)
    tts_max_sentences: int = Field(default=3, gt=0)

    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"
    output_mp3_sample_rate: int = Field(default=24_000, gt=0)
    output_mp3_bitrate: str = "96k"

    @model_validator(mode="after")
    def validate_fixed_piper_asset_path(self) -> "Settings":
        if self.piper_manifest_path != PIPER_MANIFEST_PATH:
            raise ValueError("piper_manifest_path is fixed to the approved asset mount")
        return self

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    audio_service_host: str = "127.0.0.1"
    audio_service_port: int = 8001
    internal_service_token: str = Field(min_length=16)

    hf_home: Path = Path("/opt/bmo-mvp/models/hf-cache")
    torch_home: Path = Path("/opt/bmo-mvp/models/torch-cache")
    xdg_cache_home: Path = Path("/tmp/cache")
    model_download_allowed: bool = False
    model_manifest_path: Path = Path("/opt/bmo-mvp/MODEL_MANIFEST.md")

    whisper_model: str = "small"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_cpu_threads: int = Field(default=4, gt=0)
    whisper_workers: int = Field(default=1, gt=0)
    whisper_beam_size: int = Field(default=5, gt=0)
    whisper_vad: bool = True

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

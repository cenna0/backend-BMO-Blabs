from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    audio_service_host: str = "127.0.0.1"
    audio_service_port: int = 8001
    internal_service_token: str = Field(min_length=16)

    hf_home: Path = Path("/opt/bmo/models/hf-cache")
    torch_home: Path = Path("/opt/bmo/models/torch-cache")
    xdg_cache_home: Path = Path("/tmp/cache")
    model_download_allowed: bool = False
    model_manifest_path: Path = Path("/opt/bmo/models/MODEL_MANIFEST.md")

    whisper_model: str = "medium"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_cpu_threads: int = Field(default=4, gt=0)
    whisper_workers: int = Field(default=1, gt=0)
    whisper_beam_size: int = Field(default=5, gt=0)
    whisper_vad: bool = True
    whisper_hotwords: str | None = "BMO"

    kokoro_lang_code: str = "a"
    kokoro_voice: str = "af_heart"
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
    rvc_model_repo: str = "Freaky98/CGO-adventure-time-BMO-rvc-v2-420e"
    rvc_model_revision: str = "82a8bc529bd41b930589188ead30f073d4f99fc0"
    rvc_model_archive: str = "CGO-adventure-time-BMO-rvc-v2-420e.zip"
    rvc_model_expected_size: int = 63_780_149
    rvc_model_expected_sha256: str = "dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0"
    rvc_model_path: Path | None = None
    rvc_index_path: Path | None = None
    rvc_f0_up_key: int = 0
    rvc_f0_method: str = "rmvpe"
    rvc_infer_command: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

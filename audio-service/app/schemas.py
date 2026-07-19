from pydantic import BaseModel
from uuid import UUID


class HealthResponse(BaseModel):
    status: str
    stt_loaded: bool
    kokoro_loaded: bool
    rvc_available: bool
    ffmpeg_available: bool


class TranscribeResponse(BaseModel):
    text: str
    speech_detected: bool
    language: str | None
    language_probability: float
    duration_seconds: float


class TtsRequest(BaseModel):
    request_id: UUID
    text: str
    use_rvc: bool = True

from fastapi import Depends, FastAPI, HTTPException, Request, status

from app.auth import require_internal_token
from app.config import Settings
from app.schemas import HealthResponse, TranscribeResponse
from app.stt import FasterWhisperTranscriber, Transcriber
from app.wav import WavValidationError, inspect_wav, temporary_wav_file


def create_app(
    *,
    settings: Settings | None = None,
    transcriber: Transcriber | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings()
    resolved_transcriber = transcriber or FasterWhisperTranscriber(resolved_settings)
    app = FastAPI(title="BMO Audio Service", version="0.1.0")
    app.state.settings = resolved_settings
    app.state.transcriber = resolved_transcriber

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        stt_loaded = bool(getattr(app.state.transcriber, "ready", False))
        health_status = getattr(app.state.transcriber, "health_status", None)
        return HealthResponse(
            status="ok" if stt_loaded else health_status or "error",
            stt_loaded=stt_loaded,
            kokoro_loaded=False,
            rvc_available=False,
            ffmpeg_available=False,
        )

    @app.post("/stt/transcribe", response_model=TranscribeResponse)
    async def transcribe(
        request: Request,
        _auth: None = Depends(require_internal_token),
    ) -> dict[str, object]:
        content_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
        if content_type != "audio/wav":
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="UNSUPPORTED_AUDIO_TYPE",
            )

        body = await request.body()
        try:
            inspect_wav(body)
        except WavValidationError:
            raise HTTPException(
                status_code=422,
                detail="INVALID_AUDIO_FORMAT",
            ) from None

        with temporary_wav_file(body) as path:
            result = app.state.transcriber.transcribe(path)
        return result.to_dict()

    return app

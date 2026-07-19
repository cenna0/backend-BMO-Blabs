from fastapi import Depends, FastAPI, HTTPException, Request, Response, status

from app.auth import require_internal_token
from app.config import Settings
from app.ffmpeg import FfmpegConverter
from app.kokoro_tts import KokoroSynthesizer
from app.rvc import RvcCommandConverter
from app.schemas import HealthResponse, TranscribeResponse, TtsRequest
from app.stt import FasterWhisperTranscriber, Transcriber
from app.tts import (
    TextValidationError,
    TtsOrchestrator,
    TtsSynthesizer,
    TtsSynthesisError,
    validate_tts_text,
)
from app.wav import WavValidationError, inspect_wav, temporary_wav_file


def create_app(
    *,
    settings: Settings | None = None,
    transcriber: Transcriber | None = None,
    synthesizer: TtsSynthesizer | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings()
    resolved_transcriber = transcriber or FasterWhisperTranscriber(resolved_settings)
    resolved_synthesizer = synthesizer or TtsOrchestrator(
        settings=resolved_settings,
        kokoro=KokoroSynthesizer(resolved_settings),
        ffmpeg=FfmpegConverter(resolved_settings),
        rvc=RvcCommandConverter(resolved_settings),
    )
    app = FastAPI(title="BMO Audio Service", version="0.1.0")
    app.state.settings = resolved_settings
    app.state.transcriber = resolved_transcriber
    app.state.synthesizer = resolved_synthesizer

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        stt_loaded = bool(getattr(app.state.transcriber, "ready", False))
        health_status = getattr(app.state.transcriber, "health_status", None)
        tts_state = app.state.synthesizer.health_state()
        if stt_loaded and tts_state.kokoro_loaded and tts_state.ffmpeg_available:
            status_value = "ok" if tts_state.rvc_available else "degraded"
        elif not stt_loaded and health_status == "loading":
            status_value = "loading"
        else:
            status_value = "error"
        return HealthResponse(
            status=status_value,
            stt_loaded=stt_loaded,
            kokoro_loaded=tts_state.kokoro_loaded,
            rvc_available=tts_state.rvc_available,
            ffmpeg_available=tts_state.ffmpeg_available,
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

    @app.post("/tts/synthesize")
    async def synthesize(
        payload: TtsRequest,
        _auth: None = Depends(require_internal_token),
    ) -> Response:
        try:
            text = validate_tts_text(
                payload.text,
                max_characters=resolved_settings.tts_max_characters,
                max_sentences=resolved_settings.tts_max_sentences,
            )
            result = app.state.synthesizer.synthesize(text, payload.use_rvc)
        except TextValidationError:
            raise HTTPException(status_code=422, detail="INVALID_TTS_TEXT") from None
        except TtsSynthesisError:
            raise HTTPException(status_code=500, detail="TTS_FAILED") from None
        return Response(
            content=result.audio,
            media_type="audio/mpeg",
            headers={
                "X-RVC-Applied": str(result.rvc_applied).lower(),
                "X-TTS-Engine": result.engine,
            },
        )

    return app

import asyncio
from contextlib import asynccontextmanager, suppress
import logging

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool

from app.auth import require_internal_token
from app.config import Settings
from app.ffmpeg import FfmpegConverter
from app.kokoro_tts import KokoroSynthesizer
from app.piper_tts import PiperSynthesizer
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


LOGGER = logging.getLogger("bmo.audio")


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
        rvc=None,
        piper=PiperSynthesizer(resolved_settings),
    )

    async def warm_up_component(component: object) -> None:
        warm_up = getattr(component, "warm_up", None)
        if callable(warm_up):
            await asyncio.to_thread(warm_up)

    async def warm_up_dependencies() -> None:
        failures = 0
        for component in (resolved_transcriber, resolved_synthesizer):
            try:
                await warm_up_component(component)
            except Exception:
                failures += 1
        if failures:
            LOGGER.warning("one or more mandatory audio dependencies failed to warm up")

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        warmup_task = asyncio.create_task(warm_up_dependencies())
        application.state.warmup_task = warmup_task
        yield
        if not warmup_task.done():
            warmup_task.cancel()
        with suppress(asyncio.CancelledError):
            await warmup_task
        close = getattr(resolved_synthesizer, "close", None)
        if callable(close):
            close()

    app = FastAPI(title="BMO Audio Service", version="0.1.0", lifespan=lifespan)
    app.state.settings = resolved_settings
    app.state.transcriber = resolved_transcriber
    app.state.synthesizer = resolved_synthesizer

    def current_health() -> HealthResponse:
        stt_loaded = bool(getattr(app.state.transcriber, "ready", False))
        stt_status = getattr(
            app.state.transcriber,
            "health_status",
            "ok" if stt_loaded else "error",
        )
        tts_state = app.state.synthesizer.health_state()
        tts_ready = (
            tts_state.piper_loaded
            and tts_state.kokoro_loaded
            and tts_state.ffmpeg_available
        )
        tts_status = getattr(
            app.state.synthesizer,
            "health_status",
            "ok" if tts_ready else "error",
        )
        if (
            stt_loaded
            and tts_state.piper_loaded
            and tts_state.kokoro_loaded
            and tts_state.ffmpeg_available
        ):
            status_value = "ok" if tts_state.rvc_available else "degraded"
        elif stt_status == "loading" or tts_status == "loading":
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

    async def readiness(response: Response) -> HealthResponse:
        health = current_health()
        if health.status not in {"ok", "degraded"}:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return health

    @app.get("/livez")
    async def liveness() -> dict[str, str]:
        return {"status": "ok"}

    app.get("/readyz", response_model=HealthResponse)(readiness)
    app.get("/health", response_model=HealthResponse)(readiness)

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
            result = await run_in_threadpool(app.state.transcriber.transcribe, path)
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
            result = await run_in_threadpool(
                app.state.synthesizer.synthesize,
                text,
                payload.use_rvc,
            )
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

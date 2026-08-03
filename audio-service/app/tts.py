from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Protocol
import logging
import re
import shutil
import tempfile

from app.config import PIPER_MODEL_NAME, PIPER_SPEAKER_ID, PIPER_SPEAKER_NAME, Settings


LOGGER = logging.getLogger("bmo.audio.tts")


class TextValidationError(ValueError):
    pass


class TtsSynthesisError(RuntimeError):
    pass


@dataclass(frozen=True)
class TtsEngineState:
    kokoro_loaded: bool
    ffmpeg_available: bool
    rvc_available: bool
    rvc_error: str | None = None
    piper_loaded: bool = True


@dataclass(frozen=True)
class TtsResult:
    audio: bytes
    rvc_applied: bool
    engine: str
    kokoro_seconds: float | None
    rvc_seconds: float | None
    ffmpeg_seconds: float
    piper_seconds: float | None = None
    fallback_used: bool = False
    fallback_from: str | None = None


class PiperAdapter(Protocol):
    ready: bool

    def synthesize_to_wav(self, text: str, output_path: Path) -> float:
        ...


class KokoroAdapter(Protocol):
    ready: bool

    def synthesize_to_wav(self, text: str, output_path: Path) -> float:
        ...


class FfmpegAdapter(Protocol):
    available: bool

    def convert_wav_to_mp3(self, input_wav: Path, output_mp3: Path) -> float:
        ...


class TtsSynthesizer(Protocol):
    def health_state(self) -> TtsEngineState:
        ...

    def synthesize(self, text: str, use_rvc: bool) -> TtsResult:
        ...


def validate_tts_text(
    text: str,
    *,
    max_characters: int = 600,
    max_sentences: int = 3,
) -> str:
    normalized = re.sub(r"\s+", " ", text.strip())
    if not normalized:
        raise TextValidationError("text must not be empty")
    if len(normalized) > max_characters:
        raise TextValidationError("text too long")
    if re.search(r"```|\[[^\]]+\]\(|<[^>]+>", normalized):
        raise TextValidationError("markdown/html is not plain text")
    if any(ord(character) < 32 or ord(character) == 127 for character in normalized):
        raise TextValidationError("control character is not allowed")

    sentence_endings = re.findall(r"[.!?]+(?:\s|$)", normalized)
    sentence_count = len(sentence_endings) if sentence_endings else 1
    if sentence_count > max_sentences:
        raise TextValidationError("too many sentences")
    return normalized


class TtsOrchestrator:
    def __init__(
        self,
        *,
        settings: Settings,
        kokoro: KokoroAdapter,
        ffmpeg: FfmpegAdapter,
        rvc: object | None,
        piper: PiperAdapter | None = None,
    ) -> None:
        self._settings = settings
        self._piper = piper
        self._kokoro = kokoro
        self._ffmpeg = ffmpeg
        self._rvc = rvc
        self._warmup_failed = False
        self._synthesis_lock = RLock()

    @property
    def health_status(self) -> str:
        state = self.health_state()
        if state.piper_loaded and state.kokoro_loaded and state.ffmpeg_available:
            return "ok"
        return "error" if self._warmup_failed else "loading"

    def _ffmpeg_ready(self) -> bool:
        if hasattr(self._ffmpeg, "ready"):
            return bool(getattr(self._ffmpeg, "ready"))
        return bool(getattr(self._ffmpeg, "available", False))

    def health_state(self) -> TtsEngineState:
        piper_loaded = (
            True if self._piper is None else bool(getattr(self._piper, "ready", False))
        )
        return TtsEngineState(
            kokoro_loaded=bool(getattr(self._kokoro, "ready", False)),
            ffmpeg_available=self._ffmpeg_ready(),
            rvc_available=False,
            rvc_error="RVC disabled",
            piper_loaded=piper_loaded,
        )

    def warm_up(self) -> None:
        try:
            if self._piper is not None:
                piper_warm_up = getattr(self._piper, "warm_up", None)
                if callable(piper_warm_up):
                    piper_warm_up()
                if not bool(getattr(self._piper, "ready", False)):
                    raise RuntimeError("Piper is unavailable")

            kokoro_warm_up = getattr(self._kokoro, "warm_up", None)
            if callable(kokoro_warm_up):
                kokoro_warm_up()
            if not bool(getattr(self._kokoro, "ready", False)):
                raise RuntimeError("Kokoro is unavailable")

            ffmpeg_warm_up = getattr(self._ffmpeg, "warm_up", None)
            if callable(ffmpeg_warm_up):
                ffmpeg_warm_up()
            elif not bool(getattr(self._ffmpeg, "available", False)):
                raise RuntimeError("ffmpeg is unavailable")
            self._warmup_failed = False
        except Exception:
            self._warmup_failed = True
            raise

    def synthesize(self, text: str, use_rvc: bool) -> TtsResult:
        del use_rvc  # retained in the internal request for backward compatibility; RVC is disabled.
        cleaned = validate_tts_text(
            text,
            max_characters=self._settings.tts_max_characters,
            max_sentences=self._settings.tts_max_sentences,
        )
        self._settings.tts_temp_dir.mkdir(parents=True, exist_ok=True)
        request_dir = Path(
            tempfile.mkdtemp(prefix="bmo-tts-", dir=self._settings.tts_temp_dir)
        )
        piper_wav = request_dir / "piper.wav"
        kokoro_wav = request_dir / "kokoro.wav"
        output_mp3 = request_dir / "output.mp3"
        try:
            with self._synthesis_lock:
                piper_failed = False
                piper_seconds: float | None = None
                ffmpeg_input = piper_wav
                engine = "piper"

                if self._piper is not None:
                    try:
                        piper_seconds = self._piper.synthesize_to_wav(cleaned, piper_wav)
                    except Exception:
                        piper_failed = True
                        engine = "kokoro"
                        ffmpeg_input = kokoro_wav
                        LOGGER.warning("Piper synthesis failed; using Kokoro fallback")
                else:
                    piper_failed = True
                    engine = "kokoro"
                    ffmpeg_input = kokoro_wav

                kokoro_seconds: float | None = None
                if piper_failed:
                    kokoro_seconds = self._kokoro.synthesize_to_wav(cleaned, kokoro_wav)

                ffmpeg_seconds = self._ffmpeg.convert_wav_to_mp3(
                    ffmpeg_input, output_mp3
                )
                result = TtsResult(
                    audio=output_mp3.read_bytes(),
                    rvc_applied=False,
                    engine=engine,
                    kokoro_seconds=kokoro_seconds,
                    rvc_seconds=None,
                    ffmpeg_seconds=ffmpeg_seconds,
                    piper_seconds=piper_seconds,
                    fallback_used=piper_failed and self._piper is not None,
                    fallback_from="piper" if piper_failed and self._piper is not None else None,
                )
                if result.fallback_used:
                    LOGGER.info(
                        "tts_synthesis_complete engine=kokoro voice=%s speed=%.2f "
                        "fallback_from=piper fallback_used=true rvc_applied=false",
                        self._settings.kokoro_voice,
                        self._settings.kokoro_speed,
                    )
                else:
                    LOGGER.info(
                        "tts_synthesis_complete engine=piper model=%s speaker=%s "
                        "speaker_id=%d fallback_used=false rvc_applied=false",
                        PIPER_MODEL_NAME,
                        PIPER_SPEAKER_NAME,
                        PIPER_SPEAKER_ID,
                    )
                return result
        except TextValidationError:
            raise
        except Exception as error:
            raise TtsSynthesisError("TTS_FAILED") from error
        finally:
            shutil.rmtree(request_dir, ignore_errors=True)

    def close(self) -> None:
        close = getattr(self._piper, "close", None)
        if callable(close):
            close()

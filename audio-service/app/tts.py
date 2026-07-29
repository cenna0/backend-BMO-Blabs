from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
import logging
import re
import shutil
import tempfile

from app.config import Settings


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


@dataclass(frozen=True)
class TtsResult:
    audio: bytes
    rvc_applied: bool
    engine: str
    kokoro_seconds: float
    rvc_seconds: float | None
    ffmpeg_seconds: float


class KokoroAdapter(Protocol):
    ready: bool

    def synthesize_to_wav(self, text: str, output_path: Path) -> float:
        ...


class FfmpegAdapter(Protocol):
    available: bool

    def convert_wav_to_mp3(self, input_wav: Path, output_mp3: Path) -> float:
        ...


class RvcAdapter(Protocol):
    available: bool
    error: str | None

    def convert(self, input_wav: Path, output_wav: Path) -> float:
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
        rvc: RvcAdapter | None,
    ) -> None:
        self._settings = settings
        self._kokoro = kokoro
        self._ffmpeg = ffmpeg
        self._rvc = rvc
        self._warmup_failed = False

    @property
    def health_status(self) -> str:
        state = self.health_state()
        if state.kokoro_loaded and state.ffmpeg_available:
            return "ok"
        return "error" if self._warmup_failed else "loading"

    def _ffmpeg_ready(self) -> bool:
        if hasattr(self._ffmpeg, "ready"):
            return bool(getattr(self._ffmpeg, "ready"))
        return bool(getattr(self._ffmpeg, "available", False))

    def health_state(self) -> TtsEngineState:
        rvc_available = bool(self._rvc and self._rvc.available)
        rvc_error = None
        if not rvc_available:
            rvc_error = getattr(self._rvc, "error", None) if self._rvc else "RVC unavailable"
        return TtsEngineState(
            kokoro_loaded=bool(getattr(self._kokoro, "ready", False)),
            ffmpeg_available=self._ffmpeg_ready(),
            rvc_available=rvc_available,
            rvc_error=rvc_error,
        )

    def warm_up(self) -> None:
        try:
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
        cleaned = validate_tts_text(
            text,
            max_characters=self._settings.tts_max_characters,
            max_sentences=self._settings.tts_max_sentences,
        )
        self._settings.tts_temp_dir.mkdir(parents=True, exist_ok=True)
        request_dir = Path(tempfile.mkdtemp(prefix="bmo-tts-", dir=self._settings.tts_temp_dir))
        kokoro_wav = request_dir / "kokoro.wav"
        rvc_wav = request_dir / "kokoro-rvc.wav"
        output_mp3 = request_dir / "output.mp3"
        try:
            kokoro_seconds = self._kokoro.synthesize_to_wav(cleaned, kokoro_wav)
            ffmpeg_input = kokoro_wav
            rvc_seconds: float | None = None
            rvc_applied = False
            engine = "kokoro"

            if use_rvc and self._rvc and self._rvc.available:
                try:
                    rvc_seconds = self._rvc.convert(kokoro_wav, rvc_wav)
                    ffmpeg_input = rvc_wav
                    rvc_applied = True
                    engine = "kokoro-rvc"
                except Exception as error:
                    LOGGER.warning("RVC failed; falling back to Kokoro-only: %s", error)

            ffmpeg_seconds = self._ffmpeg.convert_wav_to_mp3(ffmpeg_input, output_mp3)
            return TtsResult(
                audio=output_mp3.read_bytes(),
                rvc_applied=rvc_applied,
                engine=engine,
                kokoro_seconds=kokoro_seconds,
                rvc_seconds=rvc_seconds,
                ffmpeg_seconds=ffmpeg_seconds,
            )
        except TextValidationError:
            raise
        except Exception as error:
            raise TtsSynthesisError("TTS_FAILED") from error
        finally:
            shutil.rmtree(request_dir, ignore_errors=True)

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
    ffmpeg_available: bool
    piper_loaded: bool


@dataclass(frozen=True)
class TtsResult:
    audio: bytes
    engine: str
    ffmpeg_seconds: float
    piper_seconds: float


class PiperAdapter(Protocol):
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

    def synthesize(self, text: str) -> TtsResult:
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
        piper: PiperAdapter,
        ffmpeg: FfmpegAdapter,
    ) -> None:
        self._settings = settings
        self._piper = piper
        self._ffmpeg = ffmpeg
        self._warmup_failed = False
        self._synthesis_lock = RLock()

    @property
    def health_status(self) -> str:
        state = self.health_state()
        if state.piper_loaded and state.ffmpeg_available:
            return "ok"
        return "error" if self._warmup_failed else "loading"

    def _ffmpeg_ready(self) -> bool:
        if hasattr(self._ffmpeg, "ready"):
            return bool(getattr(self._ffmpeg, "ready"))
        return bool(getattr(self._ffmpeg, "available", False))

    def health_state(self) -> TtsEngineState:
        return TtsEngineState(
            ffmpeg_available=self._ffmpeg_ready(),
            piper_loaded=bool(getattr(self._piper, "ready", False)),
        )

    def warm_up(self) -> None:
        try:
            piper_warm_up = getattr(self._piper, "warm_up", None)
            if callable(piper_warm_up):
                piper_warm_up()
            if not bool(getattr(self._piper, "ready", False)):
                raise RuntimeError("Piper is unavailable")

            ffmpeg_warm_up = getattr(self._ffmpeg, "warm_up", None)
            if callable(ffmpeg_warm_up):
                ffmpeg_warm_up()
            elif not bool(getattr(self._ffmpeg, "available", False)):
                raise RuntimeError("ffmpeg is unavailable")
            self._warmup_failed = False
        except Exception:
            self._warmup_failed = True
            raise

    def synthesize(self, text: str) -> TtsResult:
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
        output_mp3 = request_dir / "output.mp3"
        try:
            with self._synthesis_lock:
                piper_seconds = self._piper.synthesize_to_wav(cleaned, piper_wav)
                ffmpeg_seconds = self._ffmpeg.convert_wav_to_mp3(piper_wav, output_mp3)
                result = TtsResult(
                    audio=output_mp3.read_bytes(),
                    engine="piper",
                    ffmpeg_seconds=ffmpeg_seconds,
                    piper_seconds=piper_seconds,
                )
                LOGGER.info(
                    "tts_synthesis_complete engine=piper model=%s speaker=%s speaker_id=%d",
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

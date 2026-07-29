from dataclasses import asdict, dataclass
from pathlib import Path
from threading import Lock
from typing import Callable, Iterable, Protocol

from app.config import Settings
from app.model_assets import (
    WHISPER_SPEC,
    configure_model_environment,
    runtime_snapshot_path,
    validate_model_snapshot,
)


@dataclass(frozen=True)
class SegmentTranscript:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class TranscriptionMetadata:
    language: str | None
    language_probability: float
    duration_seconds: float
    duration_after_vad: float


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    speech_detected: bool
    language: str | None
    language_probability: float
    duration_seconds: float

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class Transcriber(Protocol):
    ready: bool

    def transcribe(self, audio_path: Path) -> TranscriptionResult:
        ...


def normalize_transcription(
    segments: Iterable[SegmentTranscript],
    metadata: TranscriptionMetadata,
) -> TranscriptionResult:
    segment_list = list(segments)
    text = " ".join(part.text.strip() for part in segment_list if part.text.strip()).strip()

    if not segment_list or not text or metadata.duration_after_vad <= 0:
        return TranscriptionResult(
            text="",
            speech_detected=False,
            language=None,
            language_probability=0.0,
            duration_seconds=metadata.duration_seconds,
        )

    return TranscriptionResult(
        text=text,
        speech_detected=True,
        language=metadata.language,
        language_probability=metadata.language_probability,
        duration_seconds=metadata.duration_seconds,
    )


class FasterWhisperTranscriber:
    def __init__(self, settings: Settings, model_factory: Callable[..., object] | None = None):
        self._settings = settings
        self._model_factory = model_factory
        self._model: object | None = None
        self._load_failed = False
        self._load_lock = Lock()

    @property
    def ready(self) -> bool:
        return self._model is not None

    @property
    def health_status(self) -> str:
        if self.ready:
            return "ok"
        return "error" if self._load_failed else "loading"

    def _load_model(self) -> object:
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            factory = self._model_factory
            if factory is None:
                configure_model_environment(
                    hf_home=self._settings.hf_home,
                    torch_home=self._settings.torch_home,
                    xdg_cache_home=self._settings.xdg_cache_home,
                    downloads_allowed=self._settings.model_download_allowed,
                )
                snapshot = runtime_snapshot_path(
                    self._settings.runtime_models_root,
                    WHISPER_SPEC,
                )
                try:
                    validate_model_snapshot(snapshot, WHISPER_SPEC)
                except Exception:
                    self._load_failed = True
                    raise
                try:
                    from faster_whisper import WhisperModel
                except ImportError as error:
                    self._load_failed = True
                    raise RuntimeError("faster-whisper dependency is not installed") from error
                factory = WhisperModel
                model_reference = str(snapshot)
                local_only_options = {"local_files_only": True}
            else:
                model_reference = self._settings.whisper_model
                local_only_options = {}
            try:
                self._model = factory(
                    model_reference,
                    device=self._settings.whisper_device,
                    compute_type=self._settings.whisper_compute_type,
                    cpu_threads=self._settings.whisper_cpu_threads,
                    num_workers=self._settings.whisper_workers,
                    **local_only_options,
                )
                self._load_failed = False
                return self._model
            except Exception:
                self._load_failed = True
                raise

    def warm_up(self) -> None:
        self._load_model()

    def transcribe(self, audio_path: Path) -> TranscriptionResult:
        model = self._load_model()
        raw_segments, info = model.transcribe(
            str(audio_path),
            language=None,
            task="transcribe",
            beam_size=self._settings.whisper_beam_size,
            vad_filter=self._settings.whisper_vad,
            hotwords=self._settings.whisper_hotwords,
        )
        segments = [
            SegmentTranscript(
                start=float(getattr(segment, "start", 0.0)),
                end=float(getattr(segment, "end", 0.0)),
                text=str(getattr(segment, "text", "")),
            )
            for segment in list(raw_segments)
        ]
        metadata = TranscriptionMetadata(
            language=getattr(info, "language", None),
            language_probability=float(getattr(info, "language_probability", 0.0) or 0.0),
            duration_seconds=float(getattr(info, "duration", 0.0) or 0.0),
            duration_after_vad=float(
                getattr(info, "duration_after_vad", getattr(info, "duration", 0.0)) or 0.0,
            ),
        )
        return normalize_transcription(segments, metadata)

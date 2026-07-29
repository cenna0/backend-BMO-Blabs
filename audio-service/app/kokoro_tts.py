from __future__ import annotations

from array import array
from pathlib import Path
from threading import Lock
from typing import Callable
import os
import time
import wave

from app.config import Settings


def _extract_audio(result: object) -> object:
    if hasattr(result, "audio"):
        return getattr(result, "audio")
    if isinstance(result, tuple) and len(result) >= 3:
        return result[2]
    raise RuntimeError("Kokoro result did not include audio")


def _to_float_samples(audio: object) -> list[float]:
    value = audio
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        value = value.numpy()
    return [float(sample) for sample in value]


def _write_pcm16_wav(path: Path, samples: list[float], sample_rate: int) -> None:
    pcm = array("h")
    for sample in samples:
        clipped = max(-1.0, min(1.0, sample))
        pcm.append(int(clipped * 32767))
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())


class KokoroSynthesizer:
    def __init__(
        self,
        settings: Settings,
        pipeline_factory: Callable[[str], object] | None = None,
    ) -> None:
        self._settings = settings
        self._pipeline_factory = pipeline_factory
        self._pipeline: object | None = None
        self._load_failed = False
        self._load_lock = Lock()

    @property
    def ready(self) -> bool:
        return self._pipeline is not None

    @property
    def health_status(self) -> str:
        if self.ready:
            return "ok"
        return "error" if self._load_failed else "loading"

    def _load_pipeline(self) -> object:
        if self._pipeline is not None:
            return self._pipeline
        with self._load_lock:
            if self._pipeline is not None:
                return self._pipeline
            factory = self._pipeline_factory
            if factory is None:
                os.environ.setdefault("HF_HOME", str(self._settings.hf_home))
                os.environ.setdefault("TORCH_HOME", str(self._settings.torch_home))
                os.environ.setdefault("XDG_CACHE_HOME", str(self._settings.xdg_cache_home))
                try:
                    from kokoro import KPipeline
                except ImportError as error:
                    self._load_failed = True
                    raise RuntimeError("kokoro dependency is not installed") from error
                factory = KPipeline
            try:
                self._pipeline = factory(self._settings.kokoro_lang_code)
                self._load_failed = False
                return self._pipeline
            except Exception:
                self._load_failed = True
                raise

    def warm_up(self) -> None:
        self._load_pipeline()

    def synthesize_to_wav(self, text: str, output_path: Path) -> float:
        started = time.perf_counter()
        pipeline = self._load_pipeline()
        generator = pipeline(
            text,
            voice=self._settings.kokoro_voice,
            speed=self._settings.kokoro_speed,
        )
        samples: list[float] = []
        for result in generator:
            audio = _extract_audio(result)
            if audio is not None:
                samples.extend(_to_float_samples(audio))
        if not samples:
            raise RuntimeError("Kokoro produced no audio")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        _write_pcm16_wav(output_path, samples, self._settings.kokoro_sample_rate)
        return round(time.perf_counter() - started, 3)

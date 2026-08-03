from __future__ import annotations

from pathlib import Path
from typing import Callable
import os
import re
import time
import types
import wave

from .manifest import AssetIdentity, validate_manifest
from .shutdown import ShutdownRequested, shutdown_requested
from app.config import PIPER_SPEAKER_ID, PIPER_SPEAKER_NAME


class SynthesisError(RuntimeError):
    pass


VoiceFactory = Callable[[Path, Path], object]
ManifestValidator = Callable[[Path], AssetIdentity]


def _default_voice_factory(model_path: Path, config_path: Path) -> object:
    from piper import PiperVoice

    return PiperVoice.load(model_path, config_path=config_path, use_cuda=False)


def _synthesis_config(speaker_id: int) -> object:
    from piper import SynthesisConfig

    return SynthesisConfig(speaker_id=speaker_id)


class PiperEngine:
    def __init__(
        self,
        manifest_path: Path,
        output_root: Path,
        voice_factory: VoiceFactory | None = None,
        manifest_validator: ManifestValidator = validate_manifest,
    ) -> None:
        self.identity: AssetIdentity = manifest_validator(manifest_path)
        self.output_root = output_root.resolve(strict=True)
        self._config_factory = (
            _synthesis_config
            if voice_factory is None
            else lambda speaker_id: types.SimpleNamespace(speaker_id=speaker_id)
        )
        started = time.perf_counter()
        self._voice = (voice_factory or _default_voice_factory)(
            self.identity.model_path, self.identity.config_path
        )
        self.load_seconds = time.perf_counter() - started
        self.model_load_count = 1
        config = getattr(self._voice, "config", None)
        if (
            getattr(config, "sample_rate", None) != self.identity.sample_rate
            or getattr(config, "num_speakers", None) != 4
            or dict(getattr(config, "speaker_id_map", {})).get("prudence") != 0
        ):
            raise SynthesisError("loaded voice identity does not match manifest")

    def _output_path(self, requested: Path) -> Path:
        if requested.suffix.lower() != ".wav" or requested.exists():
            raise SynthesisError("invalid output path")
        parent = requested.parent.resolve(strict=True)
        resolved = parent / requested.name
        if parent != self.output_root and self.output_root not in parent.parents:
            raise SynthesisError("output path escaped output root")
        if any(part.is_symlink() for part in [parent, *parent.parents] if part != Path("/")):
            raise SynthesisError("output path contains a symlink")
        return resolved

    @staticmethod
    def _text(text: object) -> str:
        if not isinstance(text, str):
            raise SynthesisError("text must be a string")
        cleaned = re.sub(r"\s+", " ", text.strip())
        if not cleaned or len(cleaned) > 2000:
            raise SynthesisError("text length is invalid")
        if "[[" in cleaned or "]]" in cleaned:
            raise SynthesisError("raw phoneme input is not allowed")
        if any(ord(character) < 32 or ord(character) == 127 for character in cleaned):
            raise SynthesisError("text contains a control character")
        return cleaned

    def synthesize(
        self,
        text: object,
        output_path: Path,
        speaker_name: str,
        speaker_id: int,
    ) -> dict[str, object]:
        if speaker_name != PIPER_SPEAKER_NAME or speaker_id != PIPER_SPEAKER_ID:
            raise SynthesisError("speaker must be prudence / 0")
        cleaned = self._text(text)
        output_path = self._output_path(output_path)
        partial_path = output_path.with_name(output_path.name + ".part")
        if partial_path.exists() or partial_path.is_symlink():
            raise SynthesisError("partial output path already exists")
        started_wall = time.perf_counter()
        started_cpu = time.process_time()
        try:
            with wave.open(str(partial_path), "wb") as wav_file:
                self._voice.synthesize_wav(
                    cleaned, wav_file, syn_config=self._config_factory(speaker_id)
                )
            if partial_path.stat().st_size <= 44:
                raise SynthesisError("Piper produced no audio")
            os.replace(partial_path, output_path)
        except ShutdownRequested:
            partial_path.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)
            raise
        except Exception as error:
            partial_path.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)
            if shutdown_requested():
                raise ShutdownRequested() from None
            if isinstance(error, SynthesisError):
                raise
            raise SynthesisError("Piper synthesis failed") from error
        return {
            "synthesis_seconds": time.perf_counter() - started_wall,
            "cpu_seconds": time.process_time() - started_cpu,
            "output_path": str(output_path),
            "output_bytes": output_path.stat().st_size,
            "speaker_name": self.identity.speaker_name,
            "speaker_id": self.identity.speaker_id,
            "model_load_count": self.model_load_count,
            "pid": os.getpid(),
        }

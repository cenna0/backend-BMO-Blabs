from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import hashlib
import json

from app.config import (
    PIPER_ENGINE_REVISION,
    PIPER_MODEL_NAME,
    PIPER_SPEAKER_ID,
    PIPER_SPEAKER_NAME,
    PIPER_VOICE_REVISION,
    Settings,
)


ENGINE_REPOSITORY = "https://github.com/OHF-Voice/piper1-gpl"
ENGINE_REVISION = PIPER_ENGINE_REVISION
VOICE_REPOSITORY = "https://huggingface.co/rhasspy/piper-voices"
VOICE_REVISION = PIPER_VOICE_REVISION
PINNED_MANIFEST_SHA256 = "9e92d11f5010448b3ab978648a8a4e300501b227f73b60794b9039ca39b27383"
ENGINE_RELEASE = "v1.6.0"
ENGINE_PACKAGE = "piper-tts==1.6.0"
ENGINE_LICENSE = "GPL-3.0-or-later"
VOICE_LICENSE = "CC-BY-NC-SA-4.0"
DATASET_REPOSITORY = "https://github.com/marytts/dfki-semaine-data"
DATASET_REVISION = "cbeb97b9bb0deecf4355220fcfba280a7b30983a"
SPEAKER_MAP = {"prudence": 0, "spike": 1, "obadiah": 2, "poppy": 3}


class ManifestError(RuntimeError):
    pass


@dataclass(frozen=True)
class AssetIdentity:
    manifest_path: Path
    model_path: Path
    config_path: Path
    model_card_path: Path
    dataset_license_path: Path
    model_sha256: str
    config_sha256: str
    speaker_name: str
    speaker_id: int
    sample_rate: int
    num_speakers: int
    phoneme_type: str
    engine_revision: str
    voice_revision: str


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _mapping(value: object, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ManifestError(f"{field} must be an object")
    return value


def validate_manifest(
    manifest_path: Path, settings: Settings | None = None
) -> AssetIdentity:
    if settings is not None:
        if (
            settings.piper_model != PIPER_MODEL_NAME
            or settings.piper_speaker != PIPER_SPEAKER_NAME
            or settings.piper_speaker_id != PIPER_SPEAKER_ID
            or settings.piper_engine_revision != ENGINE_REVISION
            or settings.piper_voice_revision != VOICE_REVISION
        ):
            raise ManifestError("runtime Piper configuration is not the approved voice")
    return _validate_manifest(manifest_path, PINNED_MANIFEST_SHA256)


def _validate_manifest(
    manifest_path: Path, expected_manifest_sha256: str
) -> AssetIdentity:
    manifest_path = manifest_path.resolve(strict=True)
    if sha256_file(manifest_path) != expected_manifest_sha256:
        raise ManifestError("trusted manifest SHA-256 mismatch")
    try:
        manifest = _mapping(
            json.loads(manifest_path.read_text(encoding="utf-8")), "manifest"
        )
    except (OSError, ValueError) as error:
        raise ManifestError("manifest is unreadable") from error

    if manifest.get("schema_version") != 1:
        raise ManifestError("unsupported manifest schema")
    engine = _mapping(manifest.get("engine"), "engine")
    voice = _mapping(manifest.get("voice"), "voice")
    if engine.get("repository") != ENGINE_REPOSITORY:
        raise ManifestError("unexpected engine repository")
    if engine.get("revision") != ENGINE_REVISION:
        raise ManifestError("unexpected engine revision")
    if engine.get("release") != ENGINE_RELEASE:
        raise ManifestError("unexpected Piper release")
    if engine.get("package") != ENGINE_PACKAGE:
        raise ManifestError("unexpected Piper package")
    if engine.get("license") != ENGINE_LICENSE:
        raise ManifestError("unexpected engine license")
    if voice.get("repository") != VOICE_REPOSITORY:
        raise ManifestError("unexpected voice repository")
    if voice.get("revision") != VOICE_REVISION:
        raise ManifestError("unexpected voice revision")
    if voice.get("name") != "en_GB-semaine-medium":
        raise ManifestError("unexpected voice name")
    if voice.get("speaker_name") != "prudence" or voice.get("speaker_id") != 0:
        raise ManifestError("speaker mapping must be prudence: 0")
    if voice.get("sample_rate") != 22050 or voice.get("num_speakers") != 4:
        raise ManifestError("unexpected voice configuration")
    if voice.get("phoneme_type") != "espeak":
        raise ManifestError("unexpected phoneme type")
    if voice.get("espeak_voice") != "en-gb-x-rp":
        raise ManifestError("unexpected espeak voice")
    if voice.get("license") != VOICE_LICENSE:
        raise ManifestError("unexpected voice license")
    if voice.get("dataset_repository") != DATASET_REPOSITORY:
        raise ManifestError("unexpected dataset repository")
    if voice.get("dataset_revision") != DATASET_REVISION:
        raise ManifestError("unexpected dataset revision")
    if voice.get("dataset_license") != VOICE_LICENSE:
        raise ManifestError("unexpected dataset license")

    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list):
        raise ManifestError("artifacts must be an array")
    by_role: dict[str, tuple[Path, str]] = {}
    root = manifest_path.parent
    for raw_artifact in artifacts:
        artifact = _mapping(raw_artifact, "artifact")
        role = artifact.get("role")
        filename = artifact.get("filename")
        if role not in {"model", "config", "model_card", "dataset_license"}:
            raise ManifestError("artifact roles must be exact")
        if role in by_role:
            raise ManifestError(f"duplicate artifact role: {role}")
        if not isinstance(filename, str) or Path(filename).name != filename:
            raise ManifestError("artifact filename must be a basename")
        unresolved_path = root / filename
        path = unresolved_path.resolve(strict=True)
        if path.parent != root or unresolved_path.is_symlink() or not path.is_file():
            raise ManifestError("artifact filename escaped asset root")
        expected_size = artifact.get("size_bytes")
        if expected_size != path.stat().st_size:
            raise ManifestError(f"{role} size mismatch")
        expected_hash = artifact.get("sha256")
        if not isinstance(expected_hash, str) or len(expected_hash) != 64:
            raise ManifestError(f"{role} SHA-256 is invalid")
        actual_hash = sha256_file(path)
        if actual_hash != expected_hash:
            raise ManifestError(f"{role} SHA-256 mismatch")
        by_role[role] = (path, actual_hash)

    if set(by_role) != {"model", "config", "model_card", "dataset_license"}:
        raise ManifestError("artifact roles must include model, config, model_card, and dataset_license")
    model_path, model_hash = by_role["model"]
    config_path, config_hash = by_role["config"]
    if model_path.suffix != ".onnx" or config_path.name != f"{model_path.name}.json":
        raise ManifestError("model/config filenames do not match")

    try:
        config = _mapping(
            json.loads(config_path.read_text(encoding="utf-8")), "model config"
        )
    except (OSError, ValueError) as error:
        raise ManifestError("model config is unreadable") from error
    speaker_map = _mapping(config.get("speaker_id_map"), "speaker_id_map")
    audio = _mapping(config.get("audio"), "audio")
    if speaker_map != SPEAKER_MAP or voice["speaker_id"] != 0:
        raise ManifestError("actual config speaker map does not match the pinned voice")
    if config.get("num_speakers") != 4 or audio.get("sample_rate") != 22050:
        raise ManifestError("actual model configuration does not match manifest")
    if config.get("phoneme_type", "espeak") != "espeak":
        raise ManifestError("actual phoneme type is not espeak")
    espeak = _mapping(config.get("espeak"), "espeak")
    if espeak.get("voice") != "en-gb-x-rp":
        raise ManifestError("actual espeak voice does not match manifest")

    return AssetIdentity(
        manifest_path=manifest_path,
        model_path=model_path,
        config_path=config_path,
        model_card_path=by_role["model_card"][0],
        dataset_license_path=by_role["dataset_license"][0],
        model_sha256=model_hash,
        config_sha256=config_hash,
        speaker_name="prudence",
        speaker_id=0,
        sample_rate=22050,
        num_speakers=4,
        phoneme_type="espeak",
        engine_revision=ENGINE_REVISION,
        voice_revision=VOICE_REVISION,
    )

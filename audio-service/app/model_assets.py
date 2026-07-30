from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Iterable
import json
import os
import shutil
import tempfile


@dataclass(frozen=True)
class ModelSpec:
    name: str
    repository: str
    revision: str
    required_artifacts: tuple[str, ...]
    license: str
    license_source: str


WHISPER_SPEC = ModelSpec(
    name="whisper-medium",
    repository="Systran/faster-whisper-medium",
    revision="08e178d48790749d25932bbc082711ddcfdfbc4f",
    required_artifacts=(
        "config.json",
        "model.bin",
        "tokenizer.json",
        "vocabulary.txt",
    ),
    license="MIT",
    license_source="https://huggingface.co/Systran/faster-whisper-medium",
)

KOKORO_SPEC = ModelSpec(
    name="kokoro-82m-af-heart",
    repository="hexgrad/Kokoro-82M",
    revision="f3ff3571791e39611d31c381e3a41a3af07b4987",
    required_artifacts=(
        "config.json",
        "kokoro-v1_0.pth",
        "voices/af_heart.pt",
    ),
    license="Apache-2.0",
    license_source="https://huggingface.co/hexgrad/Kokoro-82M",
)


def upstream_snapshot_path(hf_home: Path, spec: ModelSpec) -> Path:
    repository_dir = spec.repository.replace("/", "--")
    return hf_home / "hub" / f"models--{repository_dir}" / "snapshots" / spec.revision


def runtime_snapshot_path(runtime_models_root: Path, spec: ModelSpec) -> Path:
    return runtime_models_root / spec.name / spec.revision


def validate_upstream_snapshot(snapshot: Path, spec: ModelSpec) -> None:
    missing = [
        relative_path
        for relative_path in spec.required_artifacts
        if not (snapshot / relative_path).is_file()
    ]
    if missing:
        missing_list = ", ".join(missing)
        raise RuntimeError(
            f"{spec.name} upstream snapshot is missing mandatory artifacts: {missing_list}",
        )


def validate_model_snapshot(snapshot: Path, spec: ModelSpec) -> None:
    expected = set(spec.required_artifacts)
    missing = [
        relative_path
        for relative_path in spec.required_artifacts
        if not (snapshot / relative_path).is_file()
    ]
    if missing:
        missing_list = ", ".join(missing)
        raise RuntimeError(
            f"{spec.name} snapshot is missing mandatory artifacts: {missing_list}",
        )
    linked = [
        relative_path
        for relative_path in spec.required_artifacts
        if (snapshot / relative_path).is_symlink()
    ]
    if linked:
        linked_list = ", ".join(linked)
        raise RuntimeError(
            f"{spec.name} runtime artifacts must be materialized regular files: {linked_list}",
        )
    actual = {
        path.relative_to(snapshot).as_posix()
        for path in snapshot.rglob("*")
        if path.is_file() or path.is_symlink()
    }
    unexpected = sorted(actual - expected)
    if unexpected:
        unexpected_list = ", ".join(unexpected)
        raise RuntimeError(
            f"{spec.name} snapshot contains unexpected artifacts: {unexpected_list}",
        )


def _artifact_evidence(artifact_path: Path) -> tuple[str, int]:
    content_hash = sha256()
    byte_size = 0
    with artifact_path.open("rb") as artifact_file:
        for chunk in iter(lambda: artifact_file.read(1024 * 1024), b""):
            content_hash.update(chunk)
            byte_size += len(chunk)
    return content_hash.hexdigest(), byte_size


def _prepare_runtime_parents(runtime_snapshot: Path) -> None:
    runtime_root = runtime_snapshot.parent.parent
    for directory in (runtime_root, runtime_snapshot.parent):
        directory.mkdir(parents=True, exist_ok=True)
        if directory.is_symlink() or not directory.is_dir():
            raise RuntimeError(f"runtime model directory is not a regular directory: {directory}")
        directory.chmod(0o755)


def _set_runtime_snapshot_permissions(snapshot: Path) -> None:
    for path in snapshot.rglob("*"):
        if path.is_symlink():
            raise RuntimeError(f"runtime model snapshot contains a symlink: {path}")
        if path.is_dir():
            path.chmod(0o755)
        elif path.is_file():
            path.chmod(0o644)
        else:
            raise RuntimeError(f"runtime model snapshot contains a non-regular entry: {path}")
    snapshot.chmod(0o755)


def materialize_runtime_snapshot(
    *,
    upstream_snapshot: Path,
    runtime_snapshot: Path,
    spec: ModelSpec,
) -> None:
    validate_upstream_snapshot(upstream_snapshot, spec)
    _prepare_runtime_parents(runtime_snapshot)
    if runtime_snapshot.exists():
        validate_model_snapshot(runtime_snapshot, spec)
        mismatched = [
            relative_path
            for relative_path in spec.required_artifacts
            if _artifact_evidence(upstream_snapshot / relative_path)
            != _artifact_evidence(runtime_snapshot / relative_path)
        ]
        if mismatched:
            mismatch_list = ", ".join(mismatched)
            raise RuntimeError(
                f"{spec.name} existing runtime artifacts differ from pinned upstream: "
                f"{mismatch_list}",
            )
        _set_runtime_snapshot_permissions(runtime_snapshot)
        return

    temporary_snapshot = Path(
        tempfile.mkdtemp(
            prefix=f".{spec.revision}.",
            dir=runtime_snapshot.parent,
        ),
    )
    try:
        for relative_path in spec.required_artifacts:
            source = upstream_snapshot / relative_path
            target = temporary_snapshot / relative_path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target, follow_symlinks=True)
        validate_model_snapshot(temporary_snapshot, spec)
        _set_runtime_snapshot_permissions(temporary_snapshot)
        temporary_snapshot.rename(runtime_snapshot)
    finally:
        if temporary_snapshot.exists():
            shutil.rmtree(temporary_snapshot)


def configure_model_environment(
    *,
    hf_home: Path,
    torch_home: Path,
    xdg_cache_home: Path,
    downloads_allowed: bool,
) -> None:
    os.environ["HF_HOME"] = str(hf_home)
    os.environ["TORCH_HOME"] = str(torch_home)
    os.environ["XDG_CACHE_HOME"] = str(xdg_cache_home)
    if not downloads_allowed:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"


def build_model_manifest(
    *,
    models_dir: Path,
    snapshots: Iterable[tuple[ModelSpec, Path]],
    manifest_path: Path,
) -> dict[str, object]:
    artifacts: list[dict[str, object]] = []
    models: list[dict[str, object]] = []

    for spec, snapshot in snapshots:
        validate_model_snapshot(snapshot, spec)
        models.append(
            {
                "name": spec.name,
                "repository": spec.repository,
                "revision": spec.revision,
                "license": spec.license,
                "license_source": spec.license_source,
            },
        )
        for required_path in spec.required_artifacts:
            artifact_path = snapshot / required_path
            try:
                relative_path = artifact_path.relative_to(models_dir)
            except ValueError as error:
                raise RuntimeError(
                    f"{spec.name} snapshot must be inside models directory",
                ) from error
            content_hash, byte_size = _artifact_evidence(artifact_path)
            artifacts.append(
                {
                    "relative_path": relative_path.as_posix(),
                    "sha256": content_hash,
                    "byte_size": byte_size,
                    "repository": spec.repository,
                    "revision": spec.revision,
                    "license": spec.license,
                    "license_source": spec.license_source,
                },
            )

    manifest: dict[str, object] = {
        "status": "complete",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "models": models,
        "artifacts": artifacts,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    manifest_path.chmod(0o644)
    return manifest

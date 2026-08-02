from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import os
from pathlib import Path
import stat
from typing import Mapping


RVC_ENGINE_REPOSITORY = "RVC-Project/Retrieval-based-Voice-Conversion"
RVC_ENGINE_REVISION = "7b284a634667c34103eaaeed972b48ccdb4b893e"
RVC_SUPPORT_REPOSITORY = "lj1995/VoiceConversionWebUI"
RVC_SUPPORT_REVISION = "88e42f0cb3662ddc0dd263a4814206ce96d53214"


@dataclass(frozen=True)
class RvcArtifactSpec:
    logical_name: str
    source_repository: str
    revision: str
    source_filename: str
    relative_runtime_path: str
    size: int
    sha256: str
    license: str
    required: bool


RVC_RUNTIME_ARTIFACTS = (
    RvcArtifactSpec(
        "bmo_model",
        "Freaky98/CGO-adventure-time-BMO-rvc-v2-420e",
        "82a8bc529bd41b930589188ead30f073d4f99fc0",
        "CGO_e420_s2520.pth",
        "rvc/bmo/assets/CGO_e420_s2520.pth",
        55_226_492,
        "1fb66eb767b994e2aa470fdb0cdf793424f57503e8a67e7ee47f10c64278b260",
        "openrail",
        True,
    ),
    RvcArtifactSpec(
        "bmo_index",
        "Freaky98/CGO-adventure-time-BMO-rvc-v2-420e",
        "82a8bc529bd41b930589188ead30f073d4f99fc0",
        "added_IVF69_Flat_nprobe_1_CGO_v2.index",
        "rvc/bmo/assets/added_IVF69_Flat_nprobe_1_CGO_v2.index",
        8_553_299,
        "3cd9589905a8bef196d66749361e96bebfe852509a8e74df2e3952332440dd3d",
        "openrail",
        False,
    ),
    RvcArtifactSpec(
        "hubert",
        RVC_SUPPORT_REPOSITORY,
        RVC_SUPPORT_REVISION,
        "hubert_base.pt",
        "rvc/support/hubert_base.pt",
        189_507_909,
        "f54b40fd2802423a5643779c4861af1e9ee9c1564dc9d32f54f20b5ffba7db96",
        "MIT",
        True,
    ),
    RvcArtifactSpec(
        "rmvpe",
        RVC_SUPPORT_REPOSITORY,
        RVC_SUPPORT_REVISION,
        "rmvpe.pt",
        "rvc/support/rmvpe.pt",
        181_184_272,
        "6d62215f4306e3ca278246188607209f09af3dc77ed4232efdd069798c4ec193",
        "MIT",
        True,
    ),
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        try:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        finally:
            try:
                os.posix_fadvise(handle.fileno(), 0, 0, os.POSIX_FADV_DONTNEED)
            except (AttributeError, OSError):
                pass
    return digest.hexdigest()


def verify_exact_file(path: Path, spec: RvcArtifactSpec) -> None:
    try:
        mode = path.lstat().st_mode
    except OSError as error:
        raise ValueError(f"{spec.logical_name} asset unavailable") from error
    if not stat.S_ISREG(mode) or path.stat().st_size != spec.size:
        raise ValueError(f"{spec.logical_name} asset unavailable")
    if sha256_file(path) != spec.sha256:
        raise ValueError(f"{spec.logical_name} asset integrity mismatch")


def candidate_manifest(runtime_root: Path, *, archive_metadata: Mapping[str, object]) -> dict[str, object]:
    artifacts: list[dict[str, object]] = []
    for spec in RVC_RUNTIME_ARTIFACTS:
        path = runtime_root / spec.relative_runtime_path
        if not path.exists() and not spec.required:
            continue
        verify_exact_file(path, spec)
        artifacts.append(asdict(spec))
    return {
        "schema_version": 1,
        "status": "rvc_candidate_ready",
        "engine": {
            "repository": RVC_ENGINE_REPOSITORY,
            "revision": RVC_ENGINE_REVISION,
            "license": "MIT",
        },
        "model_archive": {
            "repository": "Freaky98/CGO-adventure-time-BMO-rvc-v2-420e",
            "revision": "82a8bc529bd41b930589188ead30f073d4f99fc0",
            "filename": "CGO-adventure-time-BMO-rvc-v2-420e.zip",
            "size": archive_metadata["size"],
            "sha256": archive_metadata["sha256"],
            "license": "openrail",
        },
        "artifacts": artifacts,
    }


def verify_runtime_manifest(
    manifest_path: Path | None,
    configured_paths: Mapping[str, Path | None],
) -> None:
    if manifest_path is None:
        raise ValueError("RVC candidate manifest unavailable")
    try:
        if manifest_path.is_symlink() or not manifest_path.is_file():
            raise ValueError
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
        raise ValueError("RVC candidate manifest unavailable") from error
    if (
        payload.get("schema_version") != 1
        or payload.get("status") != "rvc_candidate_ready"
        or payload.get("engine", {}).get("repository") != RVC_ENGINE_REPOSITORY
        or payload.get("engine", {}).get("revision") != RVC_ENGINE_REVISION
    ):
        raise ValueError("RVC candidate manifest mismatch")
    entries = {item.get("logical_name"): item for item in payload.get("artifacts", []) if isinstance(item, dict)}
    runtime_root = manifest_path.parent.resolve(strict=True)
    for spec in RVC_RUNTIME_ARTIFACTS:
        configured = configured_paths.get(spec.logical_name)
        if configured is None and not spec.required:
            continue
        if configured is None or entries.get(spec.logical_name) != asdict(spec):
            raise ValueError("RVC candidate manifest mismatch")
        expected_path = (runtime_root / spec.relative_runtime_path).resolve(strict=False)
        try:
            configured_path = configured.resolve(strict=True)
        except OSError as error:
            raise ValueError("RVC candidate manifest mismatch") from error
        if configured_path != expected_path:
            raise ValueError("RVC candidate manifest mismatch")
        verify_exact_file(configured_path, spec)

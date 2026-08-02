#!/usr/bin/env python3
from __future__ import annotations

from argparse import ArgumentParser
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.rvc import (
    RVC_MODEL_ARCHIVE,
    RVC_MODEL_EXPECTED_SHA256,
    RVC_MODEL_EXPECTED_SIZE,
    RVC_MODEL_REPO,
    RVC_MODEL_REVISION,
    RVC_RELATIVE_DIR,
)
from app.rvc_assets import (
    RVC_RUNTIME_ARTIFACTS,
    RvcArtifactSpec,
    candidate_manifest,
    verify_exact_file,
)

DEFAULT_MODELS_DIR = Path("/opt/bmo/models")
MAX_ARCHIVE_MEMBERS = 32
MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
MAX_MEMBER_UNCOMPRESSED_BYTES = 128 * 1024 * 1024
ALLOWED_SUFFIXES = frozenset({".pth", ".index"})
READ_ONLY_FILE_MODE = 0o444
READ_ONLY_DIR_MODE = 0o555
_WINDOWS_DRIVE = re.compile(r"^[A-Za-z]:")


@dataclass(frozen=True)
class RvcArchiveAsset:
    archive_name: str
    size: int
    sha256: str


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_archive(
    archive_path: Path,
    *,
    expected_size: int,
    expected_sha256: str,
) -> dict[str, object]:
    if not archive_path.is_file() or archive_path.is_symlink():
        raise ValueError("RVC archive is not a regular file")
    size = archive_path.stat().st_size
    if size != expected_size:
        raise ValueError("archive size mismatch")
    digest = sha256_file(archive_path)
    if digest != expected_sha256:
        raise ValueError("archive sha256 mismatch")
    return {"size": size, "sha256": digest}


def _safe_member_path(name: str) -> PurePosixPath:
    if not name or "\x00" in name or "\\" in name or _WINDOWS_DRIVE.match(name):
        raise ValueError("unsafe archive path")
    normalized = PurePosixPath(name)
    if normalized.is_absolute() or any(part in {"", ".", ".."} for part in normalized.parts):
        raise ValueError("unsafe archive path")
    return normalized


def _require_regular_zip_member(info: zipfile.ZipInfo) -> None:
    if info.flag_bits & 0x1:
        raise ValueError("encrypted archive member is not allowed")
    if info.create_system != 3:
        return
    mode = (info.external_attr >> 16) & 0xFFFF
    file_type = stat.S_IFMT(mode)
    if file_type not in {0, stat.S_IFREG, stat.S_IFDIR}:
        raise ValueError("archive member is not a regular file")
    if not info.is_dir() and mode & 0o111:
        raise ValueError("executable archive member is not allowed")


def _stream_member_metadata(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> tuple[int, str]:
    size = 0
    digest = hashlib.sha256()
    with archive.open(info, "r") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            size += len(chunk)
            if size > MAX_MEMBER_UNCOMPRESSED_BYTES:
                raise ValueError("archive member exceeds uncompressed size limit")
            digest.update(chunk)
    if size != info.file_size:
        raise ValueError("archive member size mismatch")
    return size, digest.hexdigest()


def inspect_rvc_archive(
    archive_path: Path,
    *,
    max_members: int = MAX_ARCHIVE_MEMBERS,
    max_total_uncompressed_bytes: int = MAX_TOTAL_UNCOMPRESSED_BYTES,
) -> list[RvcArchiveAsset]:
    assets: list[RvcArchiveAsset] = []
    seen_paths: set[str] = set()
    total_size = 0
    with zipfile.ZipFile(archive_path) as archive:
        members = archive.infolist()
        if len(members) > max_members:
            raise ValueError("archive member count exceeds limit")
        for info in members:
            normalized = _safe_member_path(info.filename)
            normalized_key = normalized.as_posix().casefold()
            if normalized_key in seen_paths:
                raise ValueError("duplicate archive path")
            seen_paths.add(normalized_key)
            _require_regular_zip_member(info)
            if info.is_dir():
                continue
            if normalized.suffix.lower() not in ALLOWED_SUFFIXES:
                raise ValueError("unexpected archive member")
            if info.file_size > MAX_MEMBER_UNCOMPRESSED_BYTES:
                raise ValueError("archive member exceeds uncompressed size limit")
            total_size += info.file_size
            if total_size > max_total_uncompressed_bytes:
                raise ValueError("archive total uncompressed size exceeds limit")
            size, digest = _stream_member_metadata(archive, info)
            assets.append(RvcArchiveAsset(info.filename, size, digest))

    if sum(asset.archive_name.lower().endswith(".pth") for asset in assets) != 1:
        raise ValueError("archive must contain exactly one .pth model asset")
    if sum(asset.archive_name.lower().endswith(".index") for asset in assets) > 1:
        raise ValueError("archive may contain at most one .index asset")
    return assets


def _verify_existing_assets(assets: list[RvcArchiveAsset], extract_dir: Path) -> list[Path]:
    if extract_dir.is_symlink() or not extract_dir.is_dir():
        raise ValueError("existing extraction target is not a regular directory")
    if extract_dir.stat().st_mode & 0o777 != READ_ONLY_DIR_MODE:
        raise ValueError("existing extraction target has unsafe permissions")
    expected_names = {PurePosixPath(asset.archive_name).name for asset in assets}
    actual_names = {path.name for path in extract_dir.iterdir()}
    if actual_names != expected_names:
        raise ValueError("existing extraction target contains unexpected files")
    result: list[Path] = []
    for asset in assets:
        target = extract_dir / PurePosixPath(asset.archive_name).name
        if target.is_symlink() or not target.is_file():
            raise ValueError("existing extracted asset is not a regular file")
        if target.stat().st_size != asset.size or sha256_file(target) != asset.sha256:
            raise ValueError("existing extracted asset does not match manifest")
        if target.stat().st_mode & 0o777 != READ_ONLY_FILE_MODE:
            raise ValueError("existing extracted asset has unsafe permissions")
        result.append(target)
    return result


def safe_extract_rvc_assets(
    archive_path: Path,
    assets: list[RvcArchiveAsset],
    extract_dir: Path,
) -> list[Path]:
    basenames = [PurePosixPath(asset.archive_name).name for asset in assets]
    if len(set(name.casefold() for name in basenames)) != len(basenames):
        raise ValueError("duplicate RVC asset basename")
    extract_dir.parent.mkdir(parents=True, exist_ok=True)
    if extract_dir.exists() or extract_dir.is_symlink():
        return _verify_existing_assets(assets, extract_dir)

    staging = Path(tempfile.mkdtemp(prefix=f".{extract_dir.name}-", dir=extract_dir.parent))
    completed = False
    try:
        extracted: list[Path] = []
        with zipfile.ZipFile(archive_path) as archive:
            for asset, basename in zip(assets, basenames):
                target = staging / basename
                flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
                if hasattr(os, "O_NOFOLLOW"):
                    flags |= os.O_NOFOLLOW
                descriptor = os.open(target, flags, READ_ONLY_FILE_MODE)
                try:
                    with archive.open(asset.archive_name, "r") as source, os.fdopen(descriptor, "wb") as output:
                        descriptor = -1
                        shutil.copyfileobj(source, output, length=1024 * 1024)
                finally:
                    if descriptor >= 0:
                        os.close(descriptor)
                target.chmod(READ_ONLY_FILE_MODE)
                if target.stat().st_size != asset.size or sha256_file(target) != asset.sha256:
                    raise ValueError("extracted RVC asset does not match inspected archive")
                extracted.append(target)
        staging.chmod(READ_ONLY_DIR_MODE)
        staging.rename(extract_dir)
        completed = True
        return [extract_dir / path.name for path in extracted]
    finally:
        if not completed:
            shutil.rmtree(staging, ignore_errors=True)


def write_manifest(
    manifest: Path,
    *,
    status: str,
    archive_metadata: dict[str, object] | None,
    assets: list[RvcArchiveAsset],
    extracted: list[Path],
    runtime_root: Path,
) -> None:
    manifest.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "status": status,
        "repo": RVC_MODEL_REPO,
        "revision": RVC_MODEL_REVISION,
        "license": "openrail",
        "archive": RVC_MODEL_ARCHIVE,
        "expected_size": RVC_MODEL_EXPECTED_SIZE,
        "expected_sha256": RVC_MODEL_EXPECTED_SHA256,
        "archive_metadata": archive_metadata,
        "assets": [asdict(asset) for asset in assets],
        "extracted": [path.relative_to(runtime_root).as_posix() for path in extracted],
    }
    temporary = manifest.with_suffix(f"{manifest.suffix}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.chmod(READ_ONLY_FILE_MODE)
    temporary.replace(manifest)


def _copy_exact_asset(source: Path, target: Path, spec: RvcArtifactSpec) -> Path:
    verify_exact_file(source, spec)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() or target.is_symlink():
        verify_exact_file(target, spec)
        if target.stat().st_mode & 0o777 != READ_ONLY_FILE_MODE:
            raise ValueError(f"existing {spec.logical_name} asset has unsafe permissions")
        return target
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}-", dir=target.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as output, source.open("rb") as input_file:
            shutil.copyfileobj(input_file, output, length=1024 * 1024)
        temporary.chmod(READ_ONLY_FILE_MODE)
        verify_exact_file(temporary, spec)
        temporary.replace(target)
        return target
    finally:
        temporary.unlink(missing_ok=True)


def _copy_verified_archive(source: Path, target: Path) -> Path:
    verify_archive(
        source,
        expected_size=RVC_MODEL_EXPECTED_SIZE,
        expected_sha256=RVC_MODEL_EXPECTED_SHA256,
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() or target.is_symlink():
        verify_archive(
            target,
            expected_size=RVC_MODEL_EXPECTED_SIZE,
            expected_sha256=RVC_MODEL_EXPECTED_SHA256,
        )
        if target.stat().st_mode & 0o777 != READ_ONLY_FILE_MODE:
            raise ValueError("existing RVC archive has unsafe permissions")
        return target
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}-", dir=target.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as output, source.open("rb") as input_file:
            shutil.copyfileobj(input_file, output, length=1024 * 1024)
        temporary.chmod(READ_ONLY_FILE_MODE)
        verify_archive(
            temporary,
            expected_size=RVC_MODEL_EXPECTED_SIZE,
            expected_sha256=RVC_MODEL_EXPECTED_SHA256,
        )
        temporary.replace(target)
        return target
    finally:
        temporary.unlink(missing_ok=True)


def _write_candidate_manifest(
    manifest: Path,
    *,
    runtime_root: Path,
    archive_metadata: dict[str, object],
) -> None:
    payload = candidate_manifest(runtime_root, archive_metadata=archive_metadata)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    temporary = manifest.with_suffix(f"{manifest.suffix}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.chmod(READ_ONLY_FILE_MODE)
    temporary.replace(manifest)


def main() -> int:
    parser = ArgumentParser(description="Safely bootstrap the canonical BMO RVC model.")
    parser.add_argument("--allow-download", action="store_true")
    parser.add_argument("--models-dir", type=Path, default=DEFAULT_MODELS_DIR)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--archive-source", type=Path)
    parser.add_argument("--hubert-source", type=Path)
    parser.add_argument("--rmvpe-source", type=Path)
    args = parser.parse_args()

    rvc_dir = args.models_dir / RVC_RELATIVE_DIR
    archive_dir = rvc_dir / "archive"
    extract_dir = rvc_dir / "assets"
    archive_path = archive_dir / RVC_MODEL_ARCHIVE
    manifest = args.manifest or args.models_dir / "MODEL_MANIFEST.rvc.json"

    if args.archive_source is not None:
        archive_path = _copy_verified_archive(args.archive_source, archive_path)
    elif not archive_path.is_file():
        if not args.allow_download:
            print("RVC archive missing; explicit --allow-download is required", file=sys.stderr)
            return 2
        archive_dir.mkdir(parents=True, exist_ok=True)
        from huggingface_hub import hf_hub_download

        downloaded = hf_hub_download(
            repo_id=RVC_MODEL_REPO,
            filename=RVC_MODEL_ARCHIVE,
            revision=RVC_MODEL_REVISION,
            local_dir=archive_dir,
        )
        archive_path = Path(downloaded)

    archive_metadata = verify_archive(
        archive_path,
        expected_size=RVC_MODEL_EXPECTED_SIZE,
        expected_sha256=RVC_MODEL_EXPECTED_SHA256,
    )
    assets = inspect_rvc_archive(archive_path)
    extracted = safe_extract_rvc_assets(archive_path, assets, extract_dir)
    extracted_by_name = {path.name: path for path in extracted}
    for spec in RVC_RUNTIME_ARTIFACTS[:2]:
        path = extracted_by_name.get(spec.source_filename)
        if path is None and not spec.required:
            continue
        verify_exact_file(path, spec)

    support_sources = {"hubert": args.hubert_source, "rmvpe": args.rmvpe_source}
    for spec in RVC_RUNTIME_ARTIFACTS[2:]:
        target = args.models_dir / spec.relative_runtime_path
        source = support_sources[spec.logical_name]
        if source is None and not target.exists():
            if not args.allow_download:
                print(f"{spec.logical_name} asset missing; explicit --allow-download or local source is required", file=sys.stderr)
                return 2
            from huggingface_hub import hf_hub_download
            source = Path(
                hf_hub_download(
                    repo_id=spec.source_repository,
                    filename=spec.source_filename,
                    revision=spec.revision,
                    cache_dir=args.models_dir / ".provisioning-cache",
                ),
            )
        if source is not None:
            _copy_exact_asset(source, target, spec)
        else:
            verify_exact_file(target, spec)
    _write_candidate_manifest(manifest, runtime_root=args.models_dir, archive_metadata=archive_metadata)
    print(json.dumps({"status": "rvc_model_ready", "manifest": str(manifest)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

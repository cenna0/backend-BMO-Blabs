#!/usr/bin/env python3
from __future__ import annotations

from argparse import ArgumentParser
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import hashlib
import json
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import Settings
from app.rvc import (
    RVC_MODEL_ARCHIVE,
    RVC_MODEL_EXPECTED_SHA256,
    RVC_MODEL_EXPECTED_SIZE,
    RVC_MODEL_REPO,
    RVC_MODEL_REVISION,
    RVC_RELATIVE_DIR,
)

DEFAULT_MODELS_DIR = Path("/opt/bmo/models")


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
    size = archive_path.stat().st_size
    digest = sha256_file(archive_path)
    if size != expected_size:
        raise ValueError(f"archive size mismatch: {size}")
    if digest != expected_sha256:
        raise ValueError(f"archive sha256 mismatch: {digest}")
    return {"size": size, "sha256": digest}


def _safe_member_path(name: str) -> PurePosixPath:
    normalized = PurePosixPath(name)
    if normalized.is_absolute() or ".." in normalized.parts:
        raise ValueError(f"unsafe archive path: {name}")
    return normalized


def inspect_rvc_archive(archive_path: Path) -> list[RvcArchiveAsset]:
    assets: list[RvcArchiveAsset] = []
    with zipfile.ZipFile(archive_path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            normalized = _safe_member_path(info.filename)
            if normalized.suffix.lower() not in {".pth", ".index"}:
                continue
            data = archive.read(info)
            assets.append(
                RvcArchiveAsset(
                    archive_name=info.filename,
                    size=len(data),
                    sha256=hashlib.sha256(data).hexdigest(),
                ),
            )
    if not any(asset.archive_name.lower().endswith(".pth") for asset in assets):
        raise ValueError("archive does not contain a .pth model asset")
    return assets


def safe_extract_rvc_assets(
    archive_path: Path,
    assets: list[RvcArchiveAsset],
    extract_dir: Path,
) -> list[Path]:
    extract_dir.mkdir(parents=True, exist_ok=True)
    extracted: list[Path] = []
    seen_names: set[str] = set()
    with zipfile.ZipFile(archive_path) as archive:
        for asset in assets:
            basename = PurePosixPath(asset.archive_name).name
            if basename in seen_names:
                raise ValueError(f"duplicate RVC asset basename: {basename}")
            seen_names.add(basename)
            target = extract_dir / basename
            target.write_bytes(archive.read(asset.archive_name))
            extracted.append(target)
    return extracted


def write_manifest(
    manifest: Path,
    *,
    status: str,
    archive_metadata: dict[str, object] | None,
    assets: list[RvcArchiveAsset],
    extracted: list[Path],
) -> None:
    manifest.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "status": status,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repo": RVC_MODEL_REPO,
        "revision": RVC_MODEL_REVISION,
        "archive": RVC_MODEL_ARCHIVE,
        "expected_size": RVC_MODEL_EXPECTED_SIZE,
        "expected_sha256": RVC_MODEL_EXPECTED_SHA256,
        "archive_metadata": archive_metadata,
        "assets": [asdict(asset) for asset in assets],
        "extracted": [str(path) for path in extracted],
    }
    manifest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = ArgumentParser(description="Safely bootstrap the canonical BMO RVC model.")
    parser.add_argument("--allow-download", action="store_true")
    parser.add_argument("--models-dir", type=Path, default=DEFAULT_MODELS_DIR)
    parser.add_argument("--manifest", type=Path, default=Path("MODEL_MANIFEST.rvc.json"))
    args = parser.parse_args()

    settings = Settings(internal_service_token="bootstrap-token-000")
    rvc_dir = args.models_dir / RVC_RELATIVE_DIR
    archive_dir = rvc_dir / "archive"
    extract_dir = rvc_dir / "assets"
    archive_path = archive_dir / settings.rvc_model_archive

    if not archive_path.is_file():
        if not args.allow_download:
            print("RVC archive missing; rerun with --allow-download after approval", file=sys.stderr)
            return 2
        archive_dir.mkdir(parents=True, exist_ok=True)
        from huggingface_hub import hf_hub_download

        downloaded = hf_hub_download(
            repo_id=settings.rvc_model_repo,
            filename=settings.rvc_model_archive,
            revision=settings.rvc_model_revision,
            local_dir=archive_dir,
        )
        archive_path = Path(downloaded)

    archive_metadata = verify_archive(
        archive_path,
        expected_size=settings.rvc_model_expected_size,
        expected_sha256=settings.rvc_model_expected_sha256,
    )
    assets = inspect_rvc_archive(archive_path)
    extracted = safe_extract_rvc_assets(archive_path, assets, extract_dir)
    write_manifest(
        args.manifest,
        status="rvc_model_ready",
        archive_metadata=archive_metadata,
        assets=assets,
        extracted=extracted,
    )
    print(json.dumps({"status": "rvc_model_ready", "manifest": str(args.manifest)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

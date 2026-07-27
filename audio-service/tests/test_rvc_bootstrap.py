import hashlib
from pathlib import Path
import zipfile

import pytest

from app.rvc import (
    RVC_MODEL_ARCHIVE,
    RVC_MODEL_EXPECTED_SHA256,
    RVC_MODEL_EXPECTED_SIZE,
    RVC_MODEL_REPO,
    RVC_MODEL_REVISION,
)
from scripts import bootstrap_rvc
from scripts.bootstrap_rvc import inspect_rvc_archive, safe_extract_rvc_assets, verify_archive


def make_zip(path, files):
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)


def test_rvc_constants_match_canonical_model():
    assert RVC_MODEL_REPO == "Freaky98/CGO-adventure-time-BMO-rvc-v2-420e"
    assert RVC_MODEL_REVISION == "82a8bc529bd41b930589188ead30f073d4f99fc0"
    assert RVC_MODEL_ARCHIVE == "CGO-adventure-time-BMO-rvc-v2-420e.zip"
    assert RVC_MODEL_EXPECTED_SIZE == 63_780_149
    assert RVC_MODEL_EXPECTED_SHA256 == "dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0"


def test_rvc_bootstrap_defaults_to_current_models_layout():
    assert bootstrap_rvc.DEFAULT_MODELS_DIR == Path("/opt/bmo/models")
    assert bootstrap_rvc.RVC_RELATIVE_DIR == Path("rvc/bmo")


def test_rvc_archive_inspection_accepts_only_model_assets(tmp_path):
    zip_path = tmp_path / "model.zip"
    make_zip(
        zip_path,
        {
            "voice/model.pth": b"pth",
            "voice/model.index": b"index",
            "scripts/install.py": b"print('must not run')",
        },
    )

    assets = inspect_rvc_archive(zip_path)

    assert [asset.archive_name for asset in assets] == ["voice/model.pth", "voice/model.index"]


def test_rvc_archive_rejects_path_traversal(tmp_path):
    zip_path = tmp_path / "bad.zip"
    make_zip(zip_path, {"../evil.pth": b"bad"})

    with pytest.raises(ValueError, match="unsafe archive path"):
        inspect_rvc_archive(zip_path)


def test_rvc_safe_extracts_only_inspected_assets(tmp_path):
    zip_path = tmp_path / "model.zip"
    make_zip(zip_path, {"voice/model.pth": b"pth", "scripts/install.py": b"bad"})
    assets = inspect_rvc_archive(zip_path)

    extracted = safe_extract_rvc_assets(zip_path, assets, tmp_path / "extract")

    assert [path.name for path in extracted] == ["model.pth"]
    assert extracted[0].read_bytes() == b"pth"
    assert not (tmp_path / "extract" / "scripts" / "install.py").exists()


def test_verify_archive_checks_size_and_sha256(tmp_path):
    archive = tmp_path / "archive.zip"
    archive.write_bytes(b"verified")
    expected_hash = hashlib.sha256(b"verified").hexdigest()

    metadata = verify_archive(archive, expected_size=8, expected_sha256=expected_hash)

    assert metadata["size"] == 8
    assert metadata["sha256"] == expected_hash

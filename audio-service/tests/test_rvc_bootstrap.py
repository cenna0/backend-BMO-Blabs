import hashlib
import json
from pathlib import Path
import stat
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
from scripts.bootstrap_rvc import _safe_member_path, inspect_rvc_archive, safe_extract_rvc_assets, verify_archive


def make_zip(path, files):
    with zipfile.ZipFile(path, "w") as archive:
        for item in files:
            if len(item) == 2:
                name, data = item
                archive.writestr(name, data)
            else:
                name, data, mode = item
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = mode << 16
                archive.writestr(info, data)


def test_rvc_constants_match_canonical_model():
    assert RVC_MODEL_REPO == "Freaky98/CGO-adventure-time-BMO-rvc-v2-420e"
    assert RVC_MODEL_REVISION == "82a8bc529bd41b930589188ead30f073d4f99fc0"
    assert RVC_MODEL_ARCHIVE == "CGO-adventure-time-BMO-rvc-v2-420e.zip"
    assert RVC_MODEL_EXPECTED_SIZE == 63_780_149
    assert RVC_MODEL_EXPECTED_SHA256 == "dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0"


def test_rvc_bootstrap_defaults_to_current_models_layout():
    assert bootstrap_rvc.DEFAULT_MODELS_DIR == Path("/opt/bmo/models")
    assert bootstrap_rvc.RVC_RELATIVE_DIR == Path("rvc/bmo")


def test_rvc_archive_inspection_records_exact_model_assets(tmp_path):
    zip_path = tmp_path / "model.zip"
    make_zip(zip_path, [("voice/model.pth", b"pth"), ("voice/model.index", b"index")])

    assets = inspect_rvc_archive(zip_path)

    assert [asset.archive_name for asset in assets] == ["voice/model.pth", "voice/model.index"]
    assert [asset.size for asset in assets] == [3, 5]
    assert assets[0].sha256 == hashlib.sha256(b"pth").hexdigest()


@pytest.mark.parametrize(
    "name",
    ["../evil.pth", "/absolute.pth", "C:/drive.pth", "voice\\evil.pth"],
)
def test_rvc_archive_rejects_unsafe_paths(tmp_path, name):
    zip_path = tmp_path / "bad.zip"
    make_zip(zip_path, [(name, b"bad")])

    with pytest.raises(ValueError, match="unsafe archive path"):
        inspect_rvc_archive(zip_path)


def test_rvc_archive_rejects_null_byte_before_zip_parsing():
    with pytest.raises(ValueError, match="unsafe archive path"):
        _safe_member_path("nul\x00.pth")


def test_rvc_archive_rejects_symlink(tmp_path):
    zip_path = tmp_path / "symlink.zip"
    make_zip(zip_path, [("model.pth", b"target", stat.S_IFLNK | 0o777)])

    with pytest.raises(ValueError, match="regular file"):
        inspect_rvc_archive(zip_path)


def test_rvc_archive_rejects_duplicate_normalized_path(tmp_path):
    zip_path = tmp_path / "duplicate.zip"
    make_zip(zip_path, [("voice/model.pth", b"one"), ("voice/model.pth", b"two")])

    with pytest.raises(ValueError, match="duplicate archive path"):
        inspect_rvc_archive(zip_path)


def test_rvc_archive_rejects_excessive_member_count(tmp_path):
    zip_path = tmp_path / "many.zip"
    make_zip(zip_path, [(f"model-{number}.pth", b"x") for number in range(3)])

    with pytest.raises(ValueError, match="member count"):
        inspect_rvc_archive(zip_path, max_members=2)


def test_rvc_archive_rejects_excessive_uncompressed_size(tmp_path):
    zip_path = tmp_path / "large.zip"
    make_zip(zip_path, [("model.pth", b"large")])

    with pytest.raises(ValueError, match="uncompressed size"):
        inspect_rvc_archive(zip_path, max_total_uncompressed_bytes=4)


@pytest.mark.parametrize("name", ["install.py", "run.sh", "nested.zip", "model.exe"])
def test_rvc_archive_rejects_unexpected_or_executable_content(tmp_path, name):
    zip_path = tmp_path / "unexpected.zip"
    make_zip(zip_path, [("model.pth", b"model"), (name, b"unexpected")])

    with pytest.raises(ValueError, match="unexpected archive member"):
        inspect_rvc_archive(zip_path)


def test_rvc_archive_requires_exactly_one_pth(tmp_path):
    no_model = tmp_path / "no-model.zip"
    two_models = tmp_path / "two-models.zip"
    make_zip(no_model, [("model.index", b"index")])
    make_zip(two_models, [("a.pth", b"a"), ("b.pth", b"b")])

    with pytest.raises(ValueError, match="exactly one .pth"):
        inspect_rvc_archive(no_model)
    with pytest.raises(ValueError, match="exactly one .pth"):
        inspect_rvc_archive(two_models)


def test_rvc_archive_allows_missing_index(tmp_path):
    zip_path = tmp_path / "model.zip"
    make_zip(zip_path, [("model.pth", b"pth")])

    assets = inspect_rvc_archive(zip_path)

    assert [asset.archive_name for asset in assets] == ["model.pth"]


def test_rvc_safe_extracts_only_inspected_assets_and_is_idempotent(tmp_path):
    zip_path = tmp_path / "model.zip"
    make_zip(zip_path, [("voice/model.pth", b"pth"), ("voice/model.index", b"index")])
    assets = inspect_rvc_archive(zip_path)
    extract_dir = tmp_path / "extract"

    first = safe_extract_rvc_assets(zip_path, assets, extract_dir)
    second = safe_extract_rvc_assets(zip_path, assets, extract_dir)

    assert [path.name for path in first] == ["model.pth", "model.index"]
    assert first == second
    assert [path.read_bytes() for path in first] == [b"pth", b"index"]
    assert all(path.stat().st_mode & 0o777 == 0o444 for path in first)
    assert extract_dir.stat().st_mode & 0o777 == 0o555


def test_rvc_safe_extract_rejects_changed_existing_asset(tmp_path):
    zip_path = tmp_path / "model.zip"
    make_zip(zip_path, [("model.pth", b"pth")])
    assets = inspect_rvc_archive(zip_path)
    extract_dir = tmp_path / "extract"
    extracted = safe_extract_rvc_assets(zip_path, assets, extract_dir)
    extracted[0].chmod(0o644)
    extracted[0].write_bytes(b"changed")

    with pytest.raises(ValueError, match="existing extracted asset"):
        safe_extract_rvc_assets(zip_path, assets, extract_dir)


def test_rvc_safe_extract_rejects_preexisting_symlink(tmp_path):
    zip_path = tmp_path / "model.zip"
    make_zip(zip_path, [("model.pth", b"pth")])
    assets = inspect_rvc_archive(zip_path)
    extract_dir = tmp_path / "extract"
    extract_dir.mkdir()
    (extract_dir / "model.pth").symlink_to(tmp_path / "elsewhere")
    extract_dir.chmod(bootstrap_rvc.READ_ONLY_DIR_MODE)

    with pytest.raises(ValueError, match="regular file"):
        safe_extract_rvc_assets(zip_path, assets, extract_dir)


@pytest.mark.parametrize(
    ("expected_size", "expected_hash", "message"),
    [(7, hashlib.sha256(b"verified").hexdigest(), "size"), (8, "0" * 64, "sha256")],
)
def test_verify_archive_rejects_wrong_size_or_hash(tmp_path, expected_size, expected_hash, message):
    archive = tmp_path / "archive.zip"
    archive.write_bytes(b"verified")

    with pytest.raises(ValueError, match=message):
        verify_archive(archive, expected_size=expected_size, expected_sha256=expected_hash)


def test_verify_archive_records_size_and_sha256(tmp_path):
    archive = tmp_path / "archive.zip"
    archive.write_bytes(b"verified")
    expected_hash = hashlib.sha256(b"verified").hexdigest()

    metadata = verify_archive(archive, expected_size=8, expected_sha256=expected_hash)

    assert metadata == {"size": 8, "sha256": expected_hash}


def test_manifest_uses_relative_runtime_paths_and_exact_hashes(tmp_path):
    zip_path = tmp_path / "model.zip"
    make_zip(zip_path, [("model.pth", b"pth"), ("model.index", b"index")])
    assets = inspect_rvc_archive(zip_path)
    runtime_root = tmp_path / "runtime"
    extracted = safe_extract_rvc_assets(zip_path, assets, runtime_root / "rvc/bmo")
    manifest = runtime_root / "MODEL_MANIFEST.rvc.json"

    bootstrap_rvc.write_manifest(
        manifest,
        status="rvc_model_ready",
        archive_metadata={"size": 1, "sha256": "a" * 64},
        assets=assets,
        extracted=extracted,
        runtime_root=runtime_root,
    )

    payload = json.loads(manifest.read_text())
    assert payload["schema_version"] == 1
    assert payload["license"] == "openrail"
    assert payload["extracted"] == ["rvc/bmo/model.pth", "rvc/bmo/model.index"]
    assert payload["assets"][0]["sha256"] == hashlib.sha256(b"pth").hexdigest()
    assert "generated_at" not in payload

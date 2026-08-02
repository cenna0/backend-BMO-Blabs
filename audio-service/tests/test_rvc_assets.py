from dataclasses import asdict
import json

import pytest

from app import rvc_assets
from app.rvc_assets import (
    RVC_ENGINE_REVISION,
    RVC_RUNTIME_ARTIFACTS,
    RVC_SUPPORT_REVISION,
    verify_runtime_manifest,
)


def test_sha256_file_releases_read_pages_after_hashing(tmp_path, monkeypatch):
    asset = tmp_path / "asset.bin"
    asset.write_bytes(b"immutable asset")
    calls = []
    monkeypatch.setattr(
        rvc_assets.os,
        "posix_fadvise",
        lambda fd, offset, length, advice: calls.append((fd, offset, length, advice)),
    )

    assert rvc_assets.sha256_file(asset) == (
        "e682e0ed8ab8eb2d59c1bdd38c3b1b053962e77b75542fba7edc6f43bbced316"
    )
    assert calls == [
        (calls[0][0], 0, 0, rvc_assets.os.POSIX_FADV_DONTNEED),
    ]


def test_rvc_asset_specs_are_exact_and_immutable():
    assert RVC_ENGINE_REVISION == "7b284a634667c34103eaaeed972b48ccdb4b893e"
    assert RVC_SUPPORT_REVISION == "88e42f0cb3662ddc0dd263a4814206ce96d53214"
    assert [spec.logical_name for spec in RVC_RUNTIME_ARTIFACTS] == [
        "bmo_model", "bmo_index", "hubert", "rmvpe"
    ]
    assert all(len(spec.revision) == 40 for spec in RVC_RUNTIME_ARTIFACTS)
    assert all(len(spec.sha256) == 64 for spec in RVC_RUNTIME_ARTIFACTS)
    assert RVC_RUNTIME_ARTIFACTS[1].required is False


def test_runtime_manifest_rejects_missing_or_mutable_engine_metadata(tmp_path):
    manifest = tmp_path / "MODEL_MANIFEST.rvc.json"
    manifest.write_text(
        json.dumps({
            "schema_version": 1,
            "status": "rvc_candidate_ready",
            "engine": {"repository": "mutable/fork", "revision": "main"},
            "artifacts": [asdict(spec) for spec in RVC_RUNTIME_ARTIFACTS],
        })
    )

    with pytest.raises(ValueError, match="manifest mismatch"):
        verify_runtime_manifest(manifest, {})


def test_runtime_manifest_is_required(tmp_path):
    with pytest.raises(ValueError, match="manifest unavailable"):
        verify_runtime_manifest(None, {})

import hashlib
import json

import pytest

from app.model_assets import (
    KOKORO_SPEC,
    WHISPER_SPEC,
    build_model_manifest,
    runtime_snapshot_path,
    upstream_snapshot_path,
    validate_model_snapshot,
)


def _write_snapshot(snapshot, artifacts):
    for relative_path, content in artifacts.items():
        path = snapshot / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)


def test_exact_model_specs_are_pinned_to_approved_revisions_and_artifacts():
    assert WHISPER_SPEC.repository == "Systran/faster-whisper-medium"
    assert WHISPER_SPEC.revision == "08e178d48790749d25932bbc082711ddcfdfbc4f"
    assert WHISPER_SPEC.required_artifacts == (
        "config.json",
        "model.bin",
        "tokenizer.json",
        "vocabulary.txt",
    )
    assert WHISPER_SPEC.license == "MIT"

    assert KOKORO_SPEC.repository == "hexgrad/Kokoro-82M"
    assert KOKORO_SPEC.revision == "f3ff3571791e39611d31c381e3a41a3af07b4987"
    assert KOKORO_SPEC.required_artifacts == (
        "config.json",
        "kokoro-v1_0.pth",
        "voices/af_heart.pt",
    )
    assert KOKORO_SPEC.license == "Apache-2.0"


def test_upstream_and_runtime_snapshot_paths_are_distinct_and_revision_pinned(tmp_path):
    upstream = upstream_snapshot_path(tmp_path / "hf-cache", WHISPER_SPEC)
    runtime = runtime_snapshot_path(tmp_path / "runtime", WHISPER_SPEC)

    assert upstream == (
        tmp_path
        / "hf-cache"
        / "hub"
        / "models--Systran--faster-whisper-medium"
        / "snapshots"
        / WHISPER_SPEC.revision
    )
    assert runtime == tmp_path / "runtime" / WHISPER_SPEC.name / WHISPER_SPEC.revision


def test_snapshot_validation_reports_all_missing_mandatory_artifacts(tmp_path):
    snapshot = runtime_snapshot_path(tmp_path / "runtime", KOKORO_SPEC)
    _write_snapshot(snapshot, {"config.json": b"{}"})

    with pytest.raises(
        RuntimeError,
        match=r"missing mandatory artifacts.*kokoro-v1_0\.pth.*voices/af_heart\.pt",
    ):
        validate_model_snapshot(snapshot, KOKORO_SPEC)


def test_snapshot_validation_rejects_artifacts_outside_the_exact_allowlist(tmp_path):
    snapshot = runtime_snapshot_path(tmp_path / "runtime", WHISPER_SPEC)
    _write_snapshot(
        snapshot,
        {
            **{path: b"fixture" for path in WHISPER_SPEC.required_artifacts},
            "README.md": b"unexpected",
        },
    )

    with pytest.raises(RuntimeError, match=r"unexpected artifacts.*README\.md"):
        validate_model_snapshot(snapshot, WHISPER_SPEC)


def test_manifest_records_hash_size_origin_revision_and_license_per_artifact(tmp_path):
    models_dir = tmp_path / "models"
    snapshot = runtime_snapshot_path(models_dir / "runtime", WHISPER_SPEC)
    contents = {
        "config.json": b'{"model":"medium"}',
        "model.bin": b"fixture-model",
        "tokenizer.json": b'{"tokenizer":"fixture"}',
        "vocabulary.txt": b"hello\nbmo\n",
    }
    _write_snapshot(snapshot, contents)

    manifest_path = tmp_path / "MODEL_MANIFEST.json"
    manifest = build_model_manifest(
        models_dir=models_dir,
        snapshots=((WHISPER_SPEC, snapshot),),
        manifest_path=manifest_path,
    )

    assert json.loads(manifest_path.read_text(encoding="utf-8")) == manifest
    assert manifest["status"] == "complete"
    assert len(manifest["artifacts"]) == len(contents)
    by_name = {
        artifact["relative_path"].split("/")[-1]: artifact
        for artifact in manifest["artifacts"]
    }
    for relative_path, content in contents.items():
        artifact = by_name[relative_path.split("/")[-1]]
        assert artifact["relative_path"].endswith(relative_path)
        assert not artifact["relative_path"].startswith("/")
        assert artifact["sha256"] == hashlib.sha256(content).hexdigest()
        assert artifact["byte_size"] == len(content)
        assert artifact["repository"] == WHISPER_SPEC.repository
        assert artifact["revision"] == WHISPER_SPEC.revision
        assert artifact["license"] == "MIT"
        assert artifact["license_source"] == WHISPER_SPEC.license_source

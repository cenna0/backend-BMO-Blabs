import hashlib
import json
import os
from pathlib import Path
import stat

import pytest

from app.model_assets import (
    KOKORO_SPEC,
    WHISPER_SPEC,
    runtime_snapshot_path,
    upstream_snapshot_path,
)
from scripts.bootstrap_models import provision_models


def test_provision_models_uses_only_exact_repositories_revisions_and_allowlists(tmp_path):
    models_dir = tmp_path / "models"
    calls = []

    def fake_downloader(**kwargs):
        calls.append(kwargs)
        spec = next(
            spec
            for spec in (WHISPER_SPEC, KOKORO_SPEC)
            if spec.repository == kwargs["repo_id"]
        )
        snapshot = (
            Path(kwargs["cache_dir"])
            / f"models--{spec.repository.replace('/', '--')}"
            / "snapshots"
            / spec.revision
        )
        for relative_path in spec.required_artifacts:
            artifact = snapshot / relative_path
            artifact.parent.mkdir(parents=True, exist_ok=True)
            artifact.write_bytes(f"{spec.name}:{relative_path}".encode())
        return str(snapshot)

    manifest_path = tmp_path / "MODEL_MANIFEST.json"
    manifest = provision_models(
        specs=(WHISPER_SPEC, KOKORO_SPEC),
        models_dir=models_dir,
        manifest_path=manifest_path,
        downloader=fake_downloader,
    )

    assert calls == [
        {
            "repo_id": WHISPER_SPEC.repository,
            "revision": WHISPER_SPEC.revision,
            "allow_patterns": list(WHISPER_SPEC.required_artifacts),
            "cache_dir": str(models_dir / "hf-cache" / "hub"),
        },
        {
            "repo_id": KOKORO_SPEC.repository,
            "revision": KOKORO_SPEC.revision,
            "allow_patterns": list(KOKORO_SPEC.required_artifacts),
            "cache_dir": str(models_dir / "hf-cache" / "hub"),
        },
    ]
    assert upstream_snapshot_path(models_dir / "hf-cache", WHISPER_SPEC).is_dir()
    assert upstream_snapshot_path(models_dir / "hf-cache", KOKORO_SPEC).is_dir()
    for spec in (WHISPER_SPEC, KOKORO_SPEC):
        runtime_snapshot = runtime_snapshot_path(models_dir / "runtime", spec)
        assert runtime_snapshot.is_dir()
        assert all(
            (runtime_snapshot / relative_path).is_file()
            and not (runtime_snapshot / relative_path).is_symlink()
            for relative_path in spec.required_artifacts
        )
    assert manifest["status"] == "complete"
    assert len(manifest["artifacts"]) == 7
    assert json.loads(manifest_path.read_text(encoding="utf-8")) == manifest
    for artifact in manifest["artifacts"]:
        path = models_dir / artifact["relative_path"]
        assert artifact["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()


def test_bootstrap_without_explicit_download_authorization_never_calls_downloader(
    tmp_path,
):
    called = False

    def remote_bomb(**_kwargs):
        nonlocal called
        called = True
        raise AssertionError("download should not be attempted")

    from scripts import bootstrap_models

    result = bootstrap_models.main(
        [
            "--model",
            "all",
            "--models-dir",
            str(tmp_path / "models"),
            "--manifest",
            str(tmp_path / "manifest.json"),
        ],
        downloader=remote_bomb,
    )

    assert result == 2
    assert called is False


def test_provision_rejects_downloader_snapshot_outside_the_pinned_cache_path(tmp_path):
    models_dir = tmp_path / "models"
    unexpected_snapshot = tmp_path / "unexpected-snapshot"
    for relative_path in WHISPER_SPEC.required_artifacts:
        artifact = unexpected_snapshot / relative_path
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_bytes(b"fixture")

    with pytest.raises(RuntimeError, match="unexpected snapshot path"):
        provision_models(
            specs=(WHISPER_SPEC,),
            models_dir=models_dir,
            manifest_path=tmp_path / "MODEL_MANIFEST.json",
            downloader=lambda **_kwargs: str(unexpected_snapshot),
        )


def test_provision_ignores_upstream_extras_and_curates_only_runtime_allowlist(tmp_path):
    models_dir = tmp_path / "models"
    upstream_snapshot = upstream_snapshot_path(models_dir / "hf-cache", WHISPER_SPEC)
    for relative_path in (*WHISPER_SPEC.required_artifacts, "README.md"):
        artifact = upstream_snapshot / relative_path
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_bytes(b"fixture")

    manifest = provision_models(
        specs=(WHISPER_SPEC,),
        models_dir=models_dir,
        manifest_path=tmp_path / "MODEL_MANIFEST.json",
        downloader=lambda **_kwargs: str(upstream_snapshot),
    )

    runtime_snapshot = runtime_snapshot_path(models_dir / "runtime", WHISPER_SPEC)
    assert sorted(
        path.relative_to(runtime_snapshot).as_posix()
        for path in runtime_snapshot.rglob("*")
        if path.is_file()
    ) == sorted(WHISPER_SPEC.required_artifacts)
    assert not (runtime_snapshot / "README.md").exists()
    assert all(
        artifact["relative_path"].startswith("runtime/")
        for artifact in manifest["artifacts"]
    )


def test_provision_materializes_upstream_symlinks_as_regular_runtime_files(tmp_path):
    models_dir = tmp_path / "models"
    upstream_snapshot = upstream_snapshot_path(models_dir / "hf-cache", WHISPER_SPEC)
    for relative_path in WHISPER_SPEC.required_artifacts:
        blob = upstream_snapshot.parents[1] / "blobs" / relative_path.replace("/", "--")
        blob.parent.mkdir(parents=True, exist_ok=True)
        blob.write_bytes(f"blob:{relative_path}".encode())
        upstream_artifact = upstream_snapshot / relative_path
        upstream_artifact.parent.mkdir(parents=True, exist_ok=True)
        upstream_artifact.symlink_to(blob)

    provision_models(
        specs=(WHISPER_SPEC,),
        models_dir=models_dir,
        manifest_path=tmp_path / "MODEL_MANIFEST.json",
        downloader=lambda **_kwargs: str(upstream_snapshot),
    )

    runtime_snapshot = runtime_snapshot_path(models_dir / "runtime", WHISPER_SPEC)
    for relative_path in WHISPER_SPEC.required_artifacts:
        runtime_artifact = runtime_snapshot / relative_path
        assert runtime_artifact.is_file()
        assert not runtime_artifact.is_symlink()
        assert runtime_artifact.read_bytes() == f"blob:{relative_path}".encode()


def test_clean_provision_sets_canonical_runtime_permissions_under_restrictive_umask(
    tmp_path,
):
    models_dir = tmp_path / "models"
    upstream_snapshot = upstream_snapshot_path(models_dir / "hf-cache", KOKORO_SPEC)
    for relative_path in KOKORO_SPEC.required_artifacts:
        artifact = upstream_snapshot / relative_path
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_bytes(b"fixture")

    previous_umask = os.umask(0o077)
    try:
        provision_models(
            specs=(KOKORO_SPEC,),
            models_dir=models_dir,
            manifest_path=models_dir / "runtime" / "MODEL_MANIFEST.json",
            downloader=lambda **_kwargs: str(upstream_snapshot),
        )
    finally:
        os.umask(previous_umask)

    runtime_root = models_dir / "runtime"
    runtime_snapshot = runtime_snapshot_path(runtime_root, KOKORO_SPEC)
    runtime_directories = [runtime_root, runtime_snapshot.parent, runtime_snapshot]
    runtime_directories.extend(
        path for path in runtime_snapshot.rglob("*") if path.is_dir()
    )
    runtime_files = [runtime_root / "MODEL_MANIFEST.json"]
    runtime_files.extend(path for path in runtime_snapshot.rglob("*") if path.is_file())

    assert all(
        stat.S_IMODE(path.lstat().st_mode) == 0o755
        for path in runtime_directories
    )
    assert all(
        stat.S_IMODE(path.lstat().st_mode) == 0o644 for path in runtime_files
    )
    assert all(not path.is_symlink() for path in (*runtime_directories, *runtime_files))


def test_provision_rejects_unexpected_file_in_curated_runtime_snapshot(tmp_path):
    models_dir = tmp_path / "models"
    upstream_snapshot = upstream_snapshot_path(models_dir / "hf-cache", WHISPER_SPEC)
    runtime_snapshot = runtime_snapshot_path(models_dir / "runtime", WHISPER_SPEC)
    for relative_path in WHISPER_SPEC.required_artifacts:
        upstream_artifact = upstream_snapshot / relative_path
        upstream_artifact.parent.mkdir(parents=True, exist_ok=True)
        upstream_artifact.write_bytes(b"fixture")
        runtime_artifact = runtime_snapshot / relative_path
        runtime_artifact.parent.mkdir(parents=True, exist_ok=True)
        runtime_artifact.write_bytes(b"fixture")
    (runtime_snapshot / "README.md").write_bytes(b"unexpected")

    with pytest.raises(RuntimeError, match=r"unexpected artifacts.*README\.md"):
        provision_models(
            specs=(WHISPER_SPEC,),
            models_dir=models_dir,
            manifest_path=tmp_path / "MODEL_MANIFEST.json",
            downloader=lambda **_kwargs: str(upstream_snapshot),
        )

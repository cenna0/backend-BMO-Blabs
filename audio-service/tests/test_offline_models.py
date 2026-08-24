from pathlib import Path
import os
import sys
import types

import pytest

from app.config import Settings
from app.model_assets import WHISPER_SPEC, runtime_snapshot_path
from app.stt import FasterWhisperTranscriber


@pytest.fixture(autouse=True)
def restore_model_environment(monkeypatch):
    for name in (
        "HF_HOME",
        "XDG_CACHE_HOME",
        "HF_HUB_OFFLINE",
        "TRANSFORMERS_OFFLINE",
        "HF_HUB_DISABLE_TELEMETRY",
    ):
        monkeypatch.setenv(name, os.environ.get(name, ""))


def _write_complete_snapshot(snapshot: Path, required_artifacts: tuple[str, ...]) -> None:
    for relative_path in required_artifacts:
        artifact = snapshot / relative_path
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_bytes(f"fixture:{relative_path}".encode())


def test_whisper_loads_complete_read_only_local_snapshot_without_remote_resolution(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("HF_HUB_OFFLINE", "0")
    monkeypatch.setenv("TRANSFORMERS_OFFLINE", "0")
    hf_home = tmp_path / "hf-cache"
    runtime_root = tmp_path / "runtime"
    snapshot = runtime_snapshot_path(runtime_root, WHISPER_SPEC)
    _write_complete_snapshot(snapshot, WHISPER_SPEC.required_artifacts)
    for path in sorted(snapshot.rglob("*"), reverse=True):
        path.chmod(0o555 if path.is_dir() else 0o444)
    snapshot.chmod(0o555)

    captured = {}

    class FakeWhisperModel:
        def __init__(self, model_path, **kwargs):
            captured["model_path"] = model_path
            captured["kwargs"] = kwargs

    remote_bomb = types.ModuleType("huggingface_hub")

    def fail_remote_resolution(*_args, **_kwargs):
        raise AssertionError("runtime attempted remote model resolution")

    remote_bomb.snapshot_download = fail_remote_resolution
    whisper_module = types.ModuleType("faster_whisper")
    whisper_module.WhisperModel = FakeWhisperModel
    monkeypatch.setitem(sys.modules, "huggingface_hub", remote_bomb)
    monkeypatch.setitem(sys.modules, "faster_whisper", whisper_module)

    transcriber = FasterWhisperTranscriber(
        Settings(
            internal_service_token="test-internal-token",
            hf_home=hf_home,
            runtime_models_root=runtime_root,
            model_download_allowed=False,
        ),
    )
    transcriber.warm_up()

    assert transcriber.ready is True
    assert captured["model_path"] == str(snapshot)
    assert captured["kwargs"]["local_files_only"] is True
    assert os.environ["HF_HUB_OFFLINE"] == "1"
    assert os.environ["TRANSFORMERS_OFFLINE"] == "1"


def test_whisper_missing_artifact_fails_health_cleanly_before_import(tmp_path, monkeypatch):
    hf_home = tmp_path / "hf-cache"
    runtime_root = tmp_path / "runtime"
    snapshot = runtime_snapshot_path(runtime_root, WHISPER_SPEC)
    _write_complete_snapshot(snapshot, WHISPER_SPEC.required_artifacts[:-1])

    monkeypatch.setitem(
        sys.modules,
        "faster_whisper",
        types.ModuleType("faster_whisper"),
    )
    transcriber = FasterWhisperTranscriber(
        Settings(
            internal_service_token="test-internal-token",
            hf_home=hf_home,
            runtime_models_root=runtime_root,
            model_download_allowed=False,
        ),
    )

    with pytest.raises(RuntimeError, match="vocabulary.txt"):
        transcriber.warm_up()

    assert transcriber.ready is False
    assert transcriber.health_status == "error"

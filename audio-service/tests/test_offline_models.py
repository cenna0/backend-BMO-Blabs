from pathlib import Path
import os
import sys
import types
import wave

import pytest

from app.config import Settings
from app.kokoro_tts import KokoroSynthesizer
from app.model_assets import KOKORO_SPEC, WHISPER_SPEC, runtime_snapshot_path
from app.stt import FasterWhisperTranscriber


@pytest.fixture(autouse=True)
def restore_model_environment(monkeypatch):
    for name in (
        "HF_HOME",
        "TORCH_HOME",
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


def test_kokoro_loads_local_model_and_voice_without_remote_resolution(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("HF_HUB_OFFLINE", "0")
    monkeypatch.setenv("TRANSFORMERS_OFFLINE", "0")
    hf_home = tmp_path / "hf-cache"
    runtime_root = tmp_path / "runtime"
    snapshot = runtime_snapshot_path(runtime_root, KOKORO_SPEC)
    _write_complete_snapshot(snapshot, KOKORO_SPEC.required_artifacts)
    for path in sorted(snapshot.rglob("*"), reverse=True):
        path.chmod(0o555 if path.is_dir() else 0o444)
    snapshot.chmod(0o555)

    captured = {}

    class FakeKModel:
        def __init__(self, **kwargs):
            captured["model_kwargs"] = kwargs

        def to(self, device):
            captured["device"] = device
            return self

        def eval(self):
            captured["eval"] = True
            return self

    class FakePipeline:
        def __init__(self, **kwargs):
            captured["pipeline_kwargs"] = kwargs

        def __call__(self, text, *, voice, speed):
            captured["synthesis"] = (text, voice, speed)
            return [types.SimpleNamespace(audio=[0.0, 0.1])]

    remote_bomb = types.ModuleType("huggingface_hub")

    def fail_remote_resolution(*_args, **_kwargs):
        raise AssertionError("runtime attempted remote model resolution")

    remote_bomb.hf_hub_download = fail_remote_resolution
    kokoro_module = types.ModuleType("kokoro")
    kokoro_module.KModel = FakeKModel
    kokoro_module.KPipeline = FakePipeline
    monkeypatch.setitem(sys.modules, "huggingface_hub", remote_bomb)
    monkeypatch.setitem(sys.modules, "kokoro", kokoro_module)

    synthesizer = KokoroSynthesizer(
        Settings(
            internal_service_token="test-internal-token",
            hf_home=hf_home,
            runtime_models_root=runtime_root,
            model_download_allowed=False,
        ),
    )
    output = tmp_path / "speech.wav"
    synthesizer.synthesize_to_wav("Hello BMO.", output)

    assert captured["model_kwargs"] == {
        "repo_id": KOKORO_SPEC.repository,
        "config": str(snapshot / "config.json"),
        "model": str(snapshot / "kokoro-v1_0.pth"),
    }
    assert captured["pipeline_kwargs"]["lang_code"] == "a"
    assert captured["pipeline_kwargs"]["repo_id"] == KOKORO_SPEC.repository
    assert captured["pipeline_kwargs"]["model"].__class__ is FakeKModel
    assert captured["device"] == "cpu"
    assert captured["eval"] is True
    assert captured["synthesis"] == (
        "Hello BMO.",
        str(snapshot / "voices" / "af_heart.pt"),
        0.80,
    )
    with wave.open(str(output), "rb") as wav:
        assert wav.getframerate() == 24_000


def test_kokoro_missing_voice_fails_health_cleanly_before_import(tmp_path, monkeypatch):
    hf_home = tmp_path / "hf-cache"
    runtime_root = tmp_path / "runtime"
    snapshot = runtime_snapshot_path(runtime_root, KOKORO_SPEC)
    _write_complete_snapshot(snapshot, KOKORO_SPEC.required_artifacts[:-1])

    monkeypatch.setitem(sys.modules, "kokoro", types.ModuleType("kokoro"))
    synthesizer = KokoroSynthesizer(
        Settings(
            internal_service_token="test-internal-token",
            hf_home=hf_home,
            runtime_models_root=runtime_root,
            model_download_allowed=False,
        ),
    )

    with pytest.raises(RuntimeError, match="voices/af_heart.pt"):
        synthesizer.warm_up()

    assert synthesizer.ready is False
    assert synthesizer.health_status == "error"

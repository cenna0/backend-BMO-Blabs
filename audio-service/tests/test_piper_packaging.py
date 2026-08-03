from pathlib import Path
import os


ROOT = Path(__file__).parents[1]
REPOSITORY_ROOT = Path(os.environ.get("BMO_REPO_ROOT", ROOT.parent))


def test_production_dockerfile_has_offline_non_root_piper_controls():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "piper-tts==1.6.0" in (ROOT / "requirements-runtime.lock").read_text(
        encoding="utf-8"
    )
    assert "ORT_DISABLE_ALL_NETWORK=1" in dockerfile
    assert 'ENTRYPOINT ["/usr/bin/tini", "-g", "--"]' in dockerfile
    assert "USER bmo" in dockerfile
    assert "COPY app ./app" in dockerfile
    assert ".onnx" not in dockerfile


def test_production_compose_mounts_piper_read_only_and_bounds_audio_service():
    compose = (REPOSITORY_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert "/opt/bmo/models/piper" in compose
    assert "read_only: true" in compose
    assert "mem_limit: 5g" in compose
    assert "memswap_limit: 5g" in compose
    assert 'cpus: "4.0"' in compose
    assert "pids_limit: 128" in compose
    assert "RVC_ENABLED: \"false\"" in compose
    assert "TTS_PRIMARY_ENGINE: \"piper\"" in compose
    assert "PIPER_SPEAKER_ID: \"0\"" in compose


def test_piper_model_weight_is_not_in_git_worktree():
    assert not list(ROOT.rglob("*.onnx"))
    assert not list(ROOT.rglob("*.wav"))
    assert not list(ROOT.rglob("*.mp3"))

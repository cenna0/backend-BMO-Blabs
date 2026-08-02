from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_candidate_image_is_pinned_private_and_non_root():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "python:3.10.20-slim-bookworm@sha256:9643927" in dockerfile
    assert "tini=0.19.0-1+b3" in dockerfile
    assert "ffmpeg=7:5.1.9-0+deb12u1" in dockerfile
    assert "pip install --no-index" in dockerfile
    assert "--require-hashes" in dockerfile
    assert "USER piper" in dockerfile
    assert 'ENTRYPOINT ["/usr/bin/tini", "-g", "--"]' in dockerfile
    assert "EXPOSE" not in dockerfile
    assert "download_voices" not in dockerfile


def test_dockerfile_specific_ignore_keeps_only_required_context():
    ignore = (ROOT / "Dockerfile.dockerignore").read_text(encoding="utf-8")

    assert ignore.startswith("**\n")
    assert "!piper-candidate/comparison-text.json" in ignore
    assert "!piper-candidate/Dockerfile" in ignore
    assert "!wheelhouse/**" in ignore
    assert not (ROOT / ".dockerignore").exists()

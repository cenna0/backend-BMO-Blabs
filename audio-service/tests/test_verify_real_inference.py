from scripts.verify_real_inference import model_cache_metadata


def test_model_cache_metadata_uses_configured_model_name(tmp_path):
    models_dir = tmp_path / "models"
    repo_dir = models_dir / "hf-cache" / "hub" / "models--Systran--faster-whisper-medium"
    (repo_dir / "refs").mkdir(parents=True)
    (repo_dir / "refs" / "main").write_text("medium-revision\n", encoding="utf-8")
    (repo_dir / "blobs").mkdir()
    (repo_dir / "blobs" / "model.bin").write_bytes(b"medium-model")

    metadata = model_cache_metadata(models_dir, "medium")

    assert metadata["source"] == "Systran/faster-whisper-medium"
    assert metadata["revision"] == "medium-revision"
    assert metadata["cache_dir"] == str(repo_dir)
    assert metadata["total_bytes"] == sum(
        path.stat().st_size for path in repo_dir.rglob("*") if path.is_file()
    )

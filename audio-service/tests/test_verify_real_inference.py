from scripts.verify_real_inference import model_cache_metadata
from app.model_assets import WHISPER_SPEC, runtime_snapshot_path


def test_model_cache_metadata_uses_pinned_snapshot_without_mutable_refs(tmp_path):
    models_dir = tmp_path / "models"
    snapshot = runtime_snapshot_path(models_dir / "runtime", WHISPER_SPEC)
    snapshot.mkdir(parents=True)
    (snapshot / "model.bin").write_bytes(b"medium-model")

    metadata = model_cache_metadata(models_dir, "medium")

    assert metadata["source"] == WHISPER_SPEC.repository
    assert metadata["revision"] == WHISPER_SPEC.revision
    assert metadata["cache_dir"] == str(models_dir / "runtime")
    assert metadata["total_bytes"] == len(b"medium-model")
    assert metadata["snapshot_dir"] == str(snapshot)

import json
import subprocess
import sys
from pathlib import Path


def test_bootstrap_whisper_dry_run_writes_manifest_without_model_files(tmp_path):
    manifest = tmp_path / "MODEL_MANIFEST.json"
    models_dir = tmp_path / "models"
    script = Path(__file__).resolve().parents[1] / "scripts" / "bootstrap_whisper.py"

    result = subprocess.run(
        [
            sys.executable,
            str(script),
            "--dry-run",
            "--models-dir",
            str(models_dir),
            "--manifest",
            str(manifest),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0
    data = json.loads(manifest.read_text(encoding="utf-8"))
    assert data["status"] == "dry_run"
    assert data["whisper_model"] == "medium"
    assert data["whisper_hotwords"] == "BMO"
    assert not any(models_dir.glob("**/*"))

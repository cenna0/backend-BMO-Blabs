import json
import subprocess
import sys
from pathlib import Path

from scripts import bootstrap_whisper


def test_bootstrap_whisper_defaults_to_current_models_root():
    assert bootstrap_whisper.DEFAULT_MODELS_DIR == Path("/opt/bmo/models")


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
    assert data["models"] == [
        {
            "license": "MIT",
            "license_source": "https://huggingface.co/Systran/faster-whisper-medium",
            "name": "whisper-medium",
            "repository": "Systran/faster-whisper-medium",
            "required_artifacts": [
                "config.json",
                "model.bin",
                "tokenizer.json",
                "vocabulary.txt",
            ],
            "revision": "08e178d48790749d25932bbc082711ddcfdfbc4f",
        },
    ]
    assert data["artifacts"] == []
    assert not any(models_dir.glob("**/*"))

import hashlib
import json
from pathlib import Path

import pytest

from bmo_piper.manifest import (
    ManifestError,
    _validate_manifest,
    sha256_file,
    validate_manifest,
)


def write_manifest(tmp_path: Path, *, speaker_id: int = 0) -> Path:
    tmp_path.mkdir(parents=True, exist_ok=True)
    model = tmp_path / "voice.onnx"
    config = tmp_path / "voice.onnx.json"
    card = tmp_path / "MODEL_CARD"
    dataset_license = tmp_path / "DFKI-SEMAINE-LICENSE.md"
    model.write_bytes(b"model")
    config.write_text(
        json.dumps(
            {
                "audio": {"sample_rate": 22050},
                "espeak": {"voice": "en-gb-x-rp"},
                "phoneme_type": "espeak",
                "num_speakers": 4,
                "speaker_id_map": {
                    "prudence": 0,
                    "spike": 1,
                    "obadiah": 2,
                    "poppy": 3,
                },
            }
        ),
        encoding="utf-8",
    )
    card.write_text("CC BY-NC-SA 4.0", encoding="utf-8")
    dataset_license.write_text("CC BY-NC-SA 4.0 dataset terms", encoding="utf-8")

    def artifact(path: Path, role: str) -> dict[str, object]:
        data = path.read_bytes()
        return {
            "role": role,
            "filename": path.name,
            "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }

    manifest = {
        "schema_version": 1,
        "engine": {
            "repository": "https://github.com/OHF-Voice/piper1-gpl",
            "revision": "f04d52c5528ac7cf2d73757f57990ff490f75005",
            "release": "v1.6.0",
            "package": "piper-tts==1.6.0",
            "license": "GPL-3.0-or-later",
        },
        "voice": {
            "repository": "https://huggingface.co/rhasspy/piper-voices",
            "revision": "9f967d15e9ccdf43078586d1476ee70f314401bd",
            "name": "en_GB-semaine-medium",
            "speaker_name": "prudence",
            "speaker_id": speaker_id,
            "sample_rate": 22050,
            "num_speakers": 4,
            "phoneme_type": "espeak",
            "espeak_voice": "en-gb-x-rp",
            "license": "CC-BY-NC-SA-4.0",
            "dataset_repository": "https://github.com/marytts/dfki-semaine-data",
            "dataset_revision": "cbeb97b9bb0deecf4355220fcfba280a7b30983a",
            "dataset_license": "CC-BY-NC-SA-4.0",
        },
        "artifacts": [
            artifact(model, "model"),
            artifact(config, "config"),
            artifact(card, "model_card"),
            artifact(dataset_license, "dataset_license"),
        ],
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return path


def validate_fixture(path: Path):
    return _validate_manifest(path, sha256_file(path))


def test_manifest_proves_prudence_identity(tmp_path):
    identity = validate_fixture(write_manifest(tmp_path))

    assert identity.speaker_name == "prudence"
    assert identity.speaker_id == 0
    assert identity.sample_rate == 22050
    assert identity.num_speakers == 4
    assert identity.phoneme_type == "espeak"
    assert identity.model_path.name == "voice.onnx"
    assert identity.dataset_license_path.name == "DFKI-SEMAINE-LICENSE.md"


def test_manifest_rejects_speaker_mapping_mismatch(tmp_path):
    with pytest.raises(ManifestError, match="speaker mapping"):
        validate_fixture(write_manifest(tmp_path, speaker_id=3))


def test_manifest_rejects_changed_artifact(tmp_path):
    path = write_manifest(tmp_path)
    (tmp_path / "voice.onnx").write_bytes(b"changed")

    with pytest.raises(ManifestError, match="size|SHA-256"):
        validate_fixture(path)


def test_manifest_rejects_artifact_path_escape(tmp_path):
    path = write_manifest(tmp_path)
    data = json.loads(path.read_text(encoding="utf-8"))
    data["artifacts"][0]["filename"] = "../voice.onnx"
    path.write_text(json.dumps(data), encoding="utf-8")

    with pytest.raises(ManifestError, match="filename"):
        validate_fixture(path)


@pytest.mark.parametrize(
    ("section", "field", "value"),
    [
        ("engine", "license", "MIT"),
        ("voice", "license", "CC0"),
        ("voice", "dataset_license", "CC0"),
        ("voice", "dataset_repository", "https://example.invalid/dataset"),
        ("voice", "dataset_revision", "floating-main"),
        ("voice", "espeak_voice", "en-us"),
    ],
)
def test_manifest_rejects_identity_or_license_mutation(tmp_path, section, field, value):
    path = write_manifest(tmp_path)
    data = json.loads(path.read_text(encoding="utf-8"))
    data[section][field] = value
    path.write_text(json.dumps(data), encoding="utf-8")

    with pytest.raises(ManifestError, match="unexpected"):
        validate_fixture(path)


def test_manifest_rejects_incomplete_actual_speaker_map(tmp_path):
    path = write_manifest(tmp_path)
    config_path = tmp_path / "voice.onnx.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    config["speaker_id_map"].pop("poppy")
    config_path.write_text(json.dumps(config), encoding="utf-8")
    data = json.loads(path.read_text(encoding="utf-8"))
    raw = config_path.read_bytes()
    data["artifacts"][1]["size_bytes"] = len(raw)
    data["artifacts"][1]["sha256"] = hashlib.sha256(raw).hexdigest()
    path.write_text(json.dumps(data), encoding="utf-8")

    with pytest.raises(ManifestError, match="speaker map"):
        validate_fixture(path)


@pytest.mark.parametrize("mutation", ["duplicate", "unknown", "missing"])
def test_manifest_requires_exact_artifact_roles(tmp_path, mutation):
    path = write_manifest(tmp_path)
    data = json.loads(path.read_text(encoding="utf-8"))
    if mutation == "duplicate":
        data["artifacts"].append(dict(data["artifacts"][0]))
    elif mutation == "unknown":
        data["artifacts"][0]["role"] = "other"
    else:
        data["artifacts"] = data["artifacts"][:-1]
    path.write_text(json.dumps(data), encoding="utf-8")

    with pytest.raises(ManifestError, match="artifact roles|duplicate"):
        validate_fixture(path)


def test_trusted_manifest_anchor_rejects_co_mutated_artifact_and_manifest(tmp_path):
    path = write_manifest(tmp_path)
    model = tmp_path / "voice.onnx"
    model.write_bytes(b"co-mutated model")
    data = json.loads(path.read_text(encoding="utf-8"))
    raw = model.read_bytes()
    data["artifacts"][0]["size_bytes"] = len(raw)
    data["artifacts"][0]["sha256"] = hashlib.sha256(raw).hexdigest()
    path.write_text(json.dumps(data), encoding="utf-8")

    with pytest.raises(ManifestError, match="trusted manifest SHA-256"):
        validate_manifest(path)

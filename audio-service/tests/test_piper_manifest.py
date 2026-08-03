from pathlib import Path

import pytest

from app.config import Settings
from app.piper.manifest import ManifestError, validate_manifest


def test_piper_manifest_validates_exact_approved_voice_identity(tmp_path):
    manifest = tmp_path / "PIPER_ASSET_MANIFEST.json"
    manifest.write_text("{}", encoding="utf-8")

    with pytest.raises(ManifestError, match="trusted manifest"):
        validate_manifest(manifest, Settings(internal_service_token="test-internal-token"))


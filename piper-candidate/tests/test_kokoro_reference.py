from pathlib import Path

import pytest

from bmo_piper.kokoro_reference import read_environment_value


def test_environment_reader_returns_only_requested_value(tmp_path: Path):
    path = tmp_path / "audio.env"
    path.write_text("OTHER=do-not-return\nINTERNAL_SERVICE_TOKEN=<test-fixture>\n")
    assert read_environment_value(path, "INTERNAL_SERVICE_TOKEN") == "<test-fixture>"


def test_environment_reader_rejects_missing_key(tmp_path: Path):
    path = tmp_path / "audio.env"
    path.write_text("OTHER=value\n")
    with pytest.raises(RuntimeError, match="missing"):
        read_environment_value(path, "INTERNAL_SERVICE_TOKEN")

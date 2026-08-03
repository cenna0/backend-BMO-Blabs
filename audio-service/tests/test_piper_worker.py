from pathlib import Path

import pytest

from app.config import Settings
from app.piper.worker import RequestError, handle_request


def test_worker_rejects_non_fixed_speaker(tmp_path):
    with pytest.raises(RequestError, match="invalid speaker"):
        handle_request(
            object(),
            {
                "operation": "synthesize",
                "request_id": "request-1",
                "output_path": "request-1.wav",
                "text": "Hello BMO.",
                "speaker_name": "spike",
                "speaker_id": 1,
            },
            tmp_path,
        )


def test_worker_module_exists_as_persistent_boundary():
    assert Path(__file__).parents[1].joinpath("app", "piper", "worker.py").is_file()

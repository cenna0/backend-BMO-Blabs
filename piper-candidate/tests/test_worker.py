from pathlib import Path

import pytest

from bmo_piper.worker import RequestError, handle_request


class FakeEngine:
    def synthesize(self, text, output_path, speaker_name, speaker_id):
        output_path.write_bytes(b"wav")
        return {
            "synthesis_seconds": 1.0,
            "output_path": str(output_path),
            "speaker_name": speaker_name,
            "speaker_id": speaker_id,
        }


def test_worker_accepts_only_canonical_relative_wav(tmp_path):
    output_root = tmp_path / "output"
    output_root.mkdir()

    result = handle_request(
        FakeEngine(),
        {
            "operation": "synthesize",
            "request_id": "request-01",
            "text": "Hello BMO.",
            "output_path": "request-01.wav",
            "speaker_name": "prudence",
            "speaker_id": 0,
        },
        output_root,
    )

    assert result["request_id"] == "request-01"
    assert result["event"] == "result"


@pytest.mark.parametrize(
    "change",
    [
        {"operation": "download"},
        {"output_path": "../escape.wav"},
        {"output_path": "/tmp/escape.wav"},
        {"speaker_name": "spike"},
        {"speaker_id": 1},
    ],
)
def test_worker_rejects_invalid_requests(tmp_path, change):
    output_root = tmp_path / "output"
    output_root.mkdir()
    payload = {
        "operation": "synthesize",
        "request_id": "request-01",
        "text": "Hello BMO.",
        "output_path": "request-01.wav",
        "speaker_name": "prudence",
        "speaker_id": 0,
    }
    payload.update(change)

    with pytest.raises(RequestError):
        handle_request(FakeEngine(), payload, output_root)

from pathlib import Path

from app.config import Settings
from app.piper_tts import PiperSynthesizer
from tests.helpers import write_wav_file


class FakeWorker:
    def __init__(self, command, *, cleanup_root, env, **kwargs):
        self.command = command
        self.cleanup_root = cleanup_root
        self.env = env
        self.ready = {"event": "ready", "model_load_count": 1}
        self.returncode = None
        self.pid = 1234
        self.requests = []

    def request(self, payload):
        self.requests.append(payload)
        output = self.cleanup_root / payload["output_path"]
        output.parent.mkdir(parents=True, exist_ok=True)
        write_wav_file(output, sample_rate=22_050)
        return {"event": "result", "output_path": str(output)}

    def close(self):
        self.returncode = 0


def test_piper_synthesizer_loads_worker_once_and_does_not_forward_secrets(tmp_path, monkeypatch):
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "must-not-reach-worker")
    workers = []

    def factory(*args, **kwargs):
        worker = FakeWorker(*args, **kwargs)
        workers.append(worker)
        return worker

    settings = Settings(
        internal_service_token="test-internal-token",
        tts_temp_dir=tmp_path,
    )
    synthesizer = PiperSynthesizer(settings, worker_factory=factory)
    synthesizer.warm_up()
    first = tmp_path / "request-1" / "piper.wav"
    second = tmp_path / "request-2" / "piper.wav"
    first.parent.mkdir()
    second.parent.mkdir()

    synthesizer.synthesize_to_wav("Hello BMO.", first)
    synthesizer.synthesize_to_wav("Hello BMO.", second)

    assert len(workers) == 1
    assert synthesizer.model_load_count == 1
    assert "INTERNAL_SERVICE_TOKEN" not in workers[0].env
    assert workers[0].requests[0]["speaker_name"] == "prudence"
    assert workers[0].requests[0]["speaker_id"] == 0
    assert synthesizer.ready is True


def test_piper_synthesizer_rejects_output_outside_temp_root(tmp_path):
    synthesizer = PiperSynthesizer(
        Settings(internal_service_token="test-internal-token", tts_temp_dir=tmp_path),
        worker_factory=lambda *_args, **_kwargs: None,
    )

    try:
        synthesizer.synthesize_to_wav("Hello BMO.", Path("/tmp/escape.wav"))
    except Exception as error:
        assert "output path" in str(error)
    else:
        raise AssertionError("output path escape was accepted")

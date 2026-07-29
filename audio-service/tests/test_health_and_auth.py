import threading
import time

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.stt import TranscriptionResult
from app.tts import TtsEngineState


class ReadyTranscriber:
    ready = True

    def transcribe(self, audio_path):
        return TranscriptionResult(
            text="hello bmo",
            speech_detected=True,
            language="en",
            language_probability=0.97,
            duration_seconds=1.0,
        )


class ErrorTranscriber:
    ready = False

    def transcribe(self, audio_path):
        raise RuntimeError("model unavailable")


class LoadingTranscriber:
    ready = False
    health_status = "loading"

    def transcribe(self, audio_path):
        raise RuntimeError("model loading")


class ReadySynthesizer:
    def health_state(self):
        return TtsEngineState(
            kokoro_loaded=True,
            ffmpeg_available=True,
            rvc_available=True,
            rvc_error=None,
        )


def make_client(transcriber, synthesizer=None):
    app = create_app(
        settings=Settings(internal_service_token="test-internal-token"),
        transcriber=transcriber,
        synthesizer=synthesizer or ReadySynthesizer(),
    )
    return TestClient(app)


def test_health_reports_ready_p2_and_p3_components():
    client = make_client(ReadyTranscriber())
    assert client.get("/livez").json() == {"status": "ok"}
    response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "stt_loaded": True,
        "kokoro_loaded": True,
        "rvc_available": True,
        "ffmpeg_available": True,
    }


def test_health_reports_error_when_stt_unavailable():
    client = make_client(ErrorTranscriber())
    response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["status"] == "error"
    assert response.json()["stt_loaded"] is False
    assert client.get("/livez").status_code == 200
    assert client.get("/health").status_code == 503


def test_health_reports_loading_during_model_bootstrap():
    client = make_client(LoadingTranscriber())
    response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["status"] == "loading"
    assert response.json()["stt_loaded"] is False
    assert client.get("/livez").status_code == 200


class WarmableTranscriber:
    def __init__(self, release: threading.Event):
        self.ready = False
        self.health_status = "loading"
        self.started = threading.Event()
        self.release = release

    def warm_up(self):
        self.started.set()
        self.release.wait(timeout=2)
        self.ready = True
        self.health_status = "ok"

    def transcribe(self, audio_path):
        raise AssertionError("not used")


class WarmableSynthesizer:
    def __init__(self, release: threading.Event):
        self.ready = False
        self.health_status = "loading"
        self.started = threading.Event()
        self.release = release

    def warm_up(self):
        self.started.set()
        self.release.wait(timeout=2)
        self.ready = True
        self.health_status = "ok"

    def health_state(self):
        return TtsEngineState(
            kokoro_loaded=self.ready,
            ffmpeg_available=self.ready,
            rvc_available=False,
            rvc_error="RVC disabled",
        )


def test_model_warmup_runs_in_background_without_blocking_liveness():
    release = threading.Event()
    transcriber = WarmableTranscriber(release)
    synthesizer = WarmableSynthesizer(release)
    app = create_app(
        settings=Settings(
            internal_service_token="test-internal-token",
            rvc_enabled=False,
        ),
        transcriber=transcriber,
        synthesizer=synthesizer,
    )

    with TestClient(app) as client:
        assert transcriber.started.wait(timeout=1)
        assert not synthesizer.started.is_set()
        started = time.monotonic()
        assert client.get("/livez").status_code == 200
        assert time.monotonic() - started < 0.2
        assert client.get("/readyz").status_code == 503

        release.set()
        assert synthesizer.started.wait(timeout=1)
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            response = client.get("/readyz")
            if response.status_code == 200:
                break
            time.sleep(0.01)
        assert response.status_code == 200
        assert response.json()["status"] == "degraded"


class FailedWarmupTranscriber:
    ready = False
    health_status = "loading"

    def __init__(self):
        self.finished = threading.Event()

    def warm_up(self):
        self.health_status = "error"
        self.finished.set()
        raise RuntimeError("dependency failed")

    def transcribe(self, audio_path):
        raise RuntimeError("model unavailable")


def test_warmup_failure_changes_readiness_without_stopping_liveness():
    transcriber = FailedWarmupTranscriber()
    app = create_app(
        settings=Settings(internal_service_token="test-internal-token"),
        transcriber=transcriber,
        synthesizer=ReadySynthesizer(),
    )

    with TestClient(app) as client:
        assert transcriber.finished.wait(timeout=1)
        assert client.get("/readyz").status_code == 503
        assert client.get("/health").status_code == 503
        assert client.get("/livez").status_code == 200
        assert client.get("/livez").status_code == 200


def test_transcribe_requires_internal_token():
    response = make_client(ReadyTranscriber()).post(
        "/stt/transcribe",
        content=b"not wav",
        headers={"content-type": "audio/wav"},
    )

    assert response.status_code == 401
    assert "test-internal-token" not in response.text


def test_transcribe_rejects_wrong_internal_token():
    response = make_client(ReadyTranscriber()).post(
        "/stt/transcribe",
        content=b"not wav",
        headers={
            "content-type": "audio/wav",
            "x-internal-service-token": "wrong-internal-token",
        },
    )

    assert response.status_code == 403
    assert "wrong-internal-token" not in response.text

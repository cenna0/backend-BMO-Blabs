import threading
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.stt import TranscriptionResult
from app.tts import TtsEngineState, TtsResult


class ReadyTranscriber:
    ready = True

    def transcribe(self, audio_path):
        return TranscriptionResult("hello", True, "en", 0.9, 1.0)


class FakeSynthesizer:
    def __init__(self, state: TtsEngineState | None = None):
        self.state = state or TtsEngineState(True, True, True, None)
        self.calls = []

    def health_state(self) -> TtsEngineState:
        return self.state

    def synthesize(self, text: str, use_rvc: bool) -> TtsResult:
        self.calls.append((text, use_rvc))
        return TtsResult(
            audio=b"mp3-data",
            rvc_applied=use_rvc,
            engine="kokoro-rvc" if use_rvc else "kokoro",
            kokoro_seconds=0.1,
            rvc_seconds=0.2 if use_rvc else None,
            ffmpeg_seconds=0.3,
        )


def make_client(synthesizer=None):
    app = create_app(
        settings=Settings(internal_service_token="test-internal-token"),
        transcriber=ReadyTranscriber(),
        synthesizer=synthesizer or FakeSynthesizer(),
    )
    return TestClient(app)


def auth_headers():
    return {"x-internal-service-token": "test-internal-token"}


def test_tts_synthesize_returns_mp3_headers_and_bytes():
    fake = FakeSynthesizer()
    client = make_client(fake)

    response = client.post(
        "/tts/synthesize",
        json={
            "request_id": "33333333-3333-4333-8333-333333333333",
            "text": "Hi! BMO is ready to help.",
            "use_rvc": True,
        },
        headers=auth_headers(),
    )

    assert response.status_code == 200
    assert response.content == b"mp3-data"
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["x-rvc-applied"] == "true"
    assert response.headers["x-tts-engine"] == "kokoro-rvc"
    assert fake.calls == [("Hi! BMO is ready to help.", True)]


def test_tts_synthesize_rejects_missing_internal_token():
    response = make_client().post(
        "/tts/synthesize",
        json={
            "request_id": "33333333-3333-4333-8333-333333333333",
            "text": "Hi! BMO is ready to help.",
            "use_rvc": False,
        },
    )

    assert response.status_code == 401
    assert "test-internal-token" not in response.text


def test_tts_synthesize_rejects_invalid_text():
    response = make_client().post(
        "/tts/synthesize",
        json={
            "request_id": "33333333-3333-4333-8333-333333333333",
            "text": "One. Two. Three. Four.",
            "use_rvc": False,
        },
        headers=auth_headers(),
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "INVALID_TTS_TEXT"}


def test_health_reports_ok_when_stt_kokoro_ffmpeg_and_rvc_ready():
    response = make_client(FakeSynthesizer(TtsEngineState(True, True, True, None))).get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "stt_loaded": True,
        "kokoro_loaded": True,
        "rvc_available": True,
        "ffmpeg_available": True,
    }


def test_health_reports_degraded_when_rvc_unavailable_only():
    client = make_client(
        FakeSynthesizer(TtsEngineState(True, True, False, "RVC unavailable")),
    )
    response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json()["status"] == "degraded"
    assert response.json()["kokoro_loaded"] is True
    assert response.json()["ffmpeg_available"] is True
    assert response.json()["rvc_available"] is False


def test_health_reports_error_when_kokoro_or_ffmpeg_required_component_unavailable():
    client = make_client(FakeSynthesizer(TtsEngineState(False, True, False, None)))
    response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["status"] == "error"
    assert response.json()["kokoro_loaded"] is False
    assert client.get("/livez").status_code == 200


class BlockingSynthesizer(FakeSynthesizer):
    def __init__(self):
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()

    def synthesize(self, text: str, use_rvc: bool) -> TtsResult:
        self.started.set()
        self.release.wait(timeout=2)
        return super().synthesize(text, use_rvc)


def test_synthesis_does_not_block_liveness():
    synthesizer = BlockingSynthesizer()
    app = create_app(
        settings=Settings(internal_service_token="test-internal-token"),
        transcriber=ReadyTranscriber(),
        synthesizer=synthesizer,
    )

    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as executor:
        synthesis = executor.submit(
            client.post,
            "/tts/synthesize",
            json={
                "request_id": "33333333-3333-4333-8333-333333333333",
                "text": "Hi! BMO is ready to help.",
                "use_rvc": False,
            },
            headers=auth_headers(),
        )
        assert synthesizer.started.wait(timeout=1)
        release_timer = threading.Timer(0.5, synthesizer.release.set)
        release_timer.start()
        try:
            started = time.monotonic()
            liveness = client.get("/livez")
            elapsed = time.monotonic() - started
        finally:
            synthesizer.release.set()
            release_timer.cancel()

        assert liveness.status_code == 200
        assert elapsed < 0.2
        assert synthesis.result(timeout=1).status_code == 200

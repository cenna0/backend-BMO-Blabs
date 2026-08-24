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
        self.state = state or TtsEngineState(ffmpeg_available=True, piper_loaded=True)
        self.calls = []

    def health_state(self) -> TtsEngineState:
        return self.state

    def synthesize(self, text: str) -> TtsResult:
        self.calls.append(text)
        return TtsResult(
            audio=b"mp3-data",
            engine="piper",
            ffmpeg_seconds=0.3,
            piper_seconds=0.1,
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
        },
        headers=auth_headers(),
    )

    assert response.status_code == 200
    assert response.content == b"mp3-data"
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["x-tts-engine"] == "piper"
    assert fake.calls == ["Hi! BMO is ready to help."]


def test_tts_synthesize_rejects_missing_internal_token():
    response = make_client().post(
        "/tts/synthesize",
        json={
            "request_id": "33333333-3333-4333-8333-333333333333",
            "text": "Hi! BMO is ready to help.",
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
        },
        headers=auth_headers(),
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "INVALID_TTS_TEXT"}


def test_health_is_process_liveness_only():
    response = make_client(FakeSynthesizer(TtsEngineState(ffmpeg_available=False, piper_loaded=False))).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readyz_requires_piper_and_ffmpeg():
    client = make_client(FakeSynthesizer(TtsEngineState(ffmpeg_available=True, piper_loaded=False)))
    response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json() == {
        "status": "error",
        "stt_loaded": True,
        "piper_loaded": False,
        "ffmpeg_available": True,
    }


def test_readyz_reports_all_core_dependencies_when_ready():
    client = make_client(FakeSynthesizer(TtsEngineState(ffmpeg_available=True, piper_loaded=True)))
    response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "stt_loaded": True,
        "piper_loaded": True,
        "ffmpeg_available": True,
    }
    assert client.get("/livez").status_code == 200


class BlockingSynthesizer(FakeSynthesizer):
    def __init__(self):
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()

    def synthesize(self, text: str) -> TtsResult:
        self.started.set()
        self.release.wait(timeout=2)
        return super().synthesize(text)


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

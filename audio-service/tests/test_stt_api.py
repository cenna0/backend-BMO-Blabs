import threading
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.stt import TranscriptionResult
from tests.helpers import make_wav


class FakeTranscriber:
    ready = True

    def __init__(self, result: TranscriptionResult):
        self.result = result
        self.paths_seen = []

    def transcribe(self, audio_path):
        self.paths_seen.append(audio_path)
        return self.result


def make_client(result: TranscriptionResult):
    fake = FakeTranscriber(result)
    app = create_app(
        settings=Settings(internal_service_token="test-internal-token"),
        transcriber=fake,
    )
    return TestClient(app), fake


def auth_headers(content_type="audio/wav"):
    return {
        "content-type": content_type,
        "x-internal-service-token": "test-internal-token",
    }


def test_transcribe_rejects_non_wav_content_type():
    client, _fake = make_client(
        TranscriptionResult("", False, None, 0.0, 0.0),
    )

    response = client.post(
        "/stt/transcribe",
        content=b"{}",
        headers=auth_headers("application/json"),
    )

    assert response.status_code == 415
    assert response.json() == {"detail": "UNSUPPORTED_AUDIO_TYPE"}


def test_transcribe_rejects_invalid_wav_bytes():
    client, _fake = make_client(
        TranscriptionResult("", False, None, 0.0, 0.0),
    )

    response = client.post(
        "/stt/transcribe",
        content=b"not a wav",
        headers=auth_headers(),
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "INVALID_AUDIO_FORMAT"}


def test_transcribe_returns_english_transcript():
    client, fake = make_client(
        TranscriptionResult("Hello BMO, how are you?", True, "en", 0.97, 0.2),
    )

    response = client.post(
        "/stt/transcribe",
        content=make_wav(),
        headers=auth_headers(),
    )

    assert response.status_code == 200
    assert response.json() == {
        "text": "Hello BMO, how are you?",
        "speech_detected": True,
        "language": "en",
        "language_probability": 0.97,
        "duration_seconds": 0.2,
    }
    assert fake.paths_seen


def test_transcribe_returns_indonesian_transcript():
    client, _fake = make_client(
        TranscriptionResult("BMO, tolong bantu aku.", True, "id", 0.91, 0.2),
    )

    response = client.post(
        "/stt/transcribe",
        content=make_wav(),
        headers=auth_headers(),
    )

    assert response.status_code == 200
    assert response.json()["language"] == "id"
    assert response.json()["text"] == "BMO, tolong bantu aku."


def test_transcribe_allows_mixed_language_transcript():
    client, _fake = make_client(
        TranscriptionResult(
            "BMO, remind aku about the meeting tomorrow.",
            True,
            "id",
            0.82,
            0.2,
        ),
    )

    response = client.post(
        "/stt/transcribe",
        content=make_wav(),
        headers=auth_headers(),
    )

    assert response.status_code == 200
    assert response.json()["speech_detected"] is True
    assert "meeting tomorrow" in response.json()["text"]


def test_transcribe_returns_no_speech_result():
    client, _fake = make_client(
        TranscriptionResult("", False, None, 0.0, 0.2),
    )

    response = client.post(
        "/stt/transcribe",
        content=make_wav(),
        headers=auth_headers(),
    )

    assert response.status_code == 200
    assert response.json() == {
        "text": "",
        "speech_detected": False,
        "language": None,
        "language_probability": 0.0,
        "duration_seconds": 0.2,
    }


class BlockingTranscriber:
    ready = True

    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()

    def transcribe(self, audio_path):
        self.started.set()
        self.release.wait(timeout=2)
        return TranscriptionResult("Hello BMO.", True, "en", 0.99, 0.2)


def test_transcription_does_not_block_liveness():
    transcriber = BlockingTranscriber()
    app = create_app(
        settings=Settings(internal_service_token="test-internal-token"),
        transcriber=transcriber,
    )

    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as executor:
        voice = executor.submit(
            client.post,
            "/stt/transcribe",
            content=make_wav(),
            headers=auth_headers(),
        )
        assert transcriber.started.wait(timeout=1)
        release_timer = threading.Timer(0.5, transcriber.release.set)
        release_timer.start()
        try:
            started = time.monotonic()
            liveness = client.get("/livez")
            elapsed = time.monotonic() - started
        finally:
            transcriber.release.set()
            release_timer.cancel()

        assert liveness.status_code == 200
        assert elapsed < 0.2
        assert voice.result(timeout=1).status_code == 200

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
    response = make_client(ReadyTranscriber()).get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "stt_loaded": True,
        "kokoro_loaded": True,
        "rvc_available": True,
        "ffmpeg_available": True,
    }


def test_health_reports_error_when_stt_unavailable():
    response = make_client(ErrorTranscriber()).get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "error"
    assert response.json()["stt_loaded"] is False


def test_health_reports_loading_during_model_bootstrap():
    response = make_client(LoadingTranscriber()).get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "loading"
    assert response.json()["stt_loaded"] is False


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

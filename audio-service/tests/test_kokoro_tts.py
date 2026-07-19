import wave

from app.config import Settings
from app.kokoro_tts import KokoroSynthesizer


class FakeResult:
    def __init__(self, audio):
        self.audio = audio


class FakePipeline:
    def __init__(self, lang_code):
        self.lang_code = lang_code
        self.calls = []

    def __call__(self, text, *, voice, speed=1.0):
        self.calls.append((text, voice, speed))
        return [FakeResult([0.0, 0.1]), FakeResult([0.2, 0.3, 0.4])]


def test_kokoro_synthesizer_merges_all_segments_into_one_24khz_wav(tmp_path):
    captured = {}

    def factory(lang_code):
        pipeline = FakePipeline(lang_code)
        captured["pipeline"] = pipeline
        return pipeline

    synthesizer = KokoroSynthesizer(
        Settings(internal_service_token="test-internal-token"),
        pipeline_factory=factory,
    )
    output = tmp_path / "kokoro.wav"

    seconds = synthesizer.synthesize_to_wav("Hi! BMO is ready to help.", output)

    assert seconds >= 0
    assert captured["pipeline"].lang_code == "a"
    assert captured["pipeline"].calls == [("Hi! BMO is ready to help.", "af_heart", 1.0)]
    with wave.open(str(output), "rb") as wav:
        assert wav.getframerate() == 24_000
        assert wav.getnchannels() == 1
        assert wav.getsampwidth() == 2
        assert wav.getnframes() == 5

from pathlib import Path

import numpy as np
import soundfile as sf

from app.config import Settings
from app.tts import validate_tts_text
from scripts import benchmark_rvc_quality


def test_quality_matrix_has_exact_bounded_canonical_phrases():
    phrases = benchmark_rvc_quality.PHRASES

    assert len(phrases) == 7
    assert phrases[0].text == "Hi! BMO is ready to help."
    assert phrases[1].text == "Do not worry. BMO is right here with you."
    assert phrases[2].text == "Yay! BMO found the answer."
    assert {phrase.category for phrase in phrases} >= {
        "short",
        "calm-medium",
        "excited-medium",
        "numbers-names-punctuation",
        "long-expected",
    }
    assert len({phrase.identifier for phrase in phrases}) == 7
    for phrase in phrases:
        assert validate_tts_text(phrase.text) == phrase.text


def test_generate_references_records_real_files_hashes_metrics_and_timings(tmp_path):
    class FakeKokoro:
        ready = True

        def synthesize_to_wav(self, _text: str, output_path: Path) -> float:
            samples = np.sin(np.linspace(0, 100, 24_000)).astype(np.float32) * 0.2
            sf.write(output_path, samples, 24_000, format="WAV", subtype="PCM_16")
            return 0.1

    settings = Settings(internal_service_token="p8-isolated-sentinel-token")

    payload = benchmark_rvc_quality.generate_references(
        settings,
        tmp_path,
        kokoro=FakeKokoro(),
    )

    assert payload["status"] == "references_ready"
    assert len(payload["samples"]) == 7
    for sample in payload["samples"]:
        assert len(sample["wav"]["sha256"]) == 64
        assert len(sample["mp3"]["sha256"]) == 64
        assert sample["wav"]["metrics"]["sample_rate"] == 24_000
        assert sample["mp3"]["probe"]["codec"] == "mp3"
        assert sample["mp3"]["probe"]["sample_rate"] == 24_000
        assert sample["mp3"]["probe"]["channels"] == 1
        assert sample["kokoro_seconds"] == 0.1
    assert (tmp_path / "references.json").is_file()

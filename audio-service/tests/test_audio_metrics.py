from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.audio_metrics import AudioMetricsError, analyze_audio, evaluate_guardrails


def write_audio(path: Path, samples: np.ndarray, sample_rate: int = 40_000) -> Path:
    sf.write(path, samples, sample_rate, format="WAV", subtype="FLOAT")
    return path


def sine(seconds: float, *, sample_rate: int = 40_000, amplitude: float = 0.2) -> np.ndarray:
    samples = np.arange(round(seconds * sample_rate), dtype=np.float64)
    return (amplitude * np.sin(2 * np.pi * 220 * samples / sample_rate)).astype(np.float32)


def test_analyze_audio_reports_required_quality_metrics(tmp_path):
    path = write_audio(tmp_path / "clean.wav", sine(1.0))

    metrics = analyze_audio(path)

    assert metrics.sample_rate == 40_000
    assert metrics.channels == 1
    assert metrics.frames == 40_000
    assert metrics.duration_seconds == pytest.approx(1.0)
    assert metrics.peak_amplitude == pytest.approx(0.2, abs=0.001)
    assert metrics.rms_amplitude == pytest.approx(0.2 / np.sqrt(2), abs=0.001)
    assert abs(metrics.dc_offset) < 0.001
    assert metrics.clipping_ratio == 0
    assert metrics.silence_ratio < 0.05
    assert metrics.leading_silence_seconds < 0.03
    assert metrics.trailing_silence_seconds < 0.03
    assert metrics.spectral_flux_p95 >= 0
    assert metrics.finite is True


@pytest.mark.parametrize("value", [np.nan, np.inf, -np.inf])
def test_analyze_audio_rejects_non_finite_samples(tmp_path, value):
    samples = sine(1.0)
    samples[10] = value
    path = write_audio(tmp_path / "bad.wav", samples)

    with pytest.raises(AudioMetricsError, match="finite"):
        analyze_audio(path)


@pytest.mark.parametrize("content", [b"", b"not audio"])
def test_analyze_audio_rejects_empty_or_unparseable_files(tmp_path, content):
    path = tmp_path / "bad.wav"
    path.write_bytes(content)

    with pytest.raises(AudioMetricsError, match="parseable"):
        analyze_audio(path)


def test_guardrails_reject_clipping_and_pathological_energy(tmp_path):
    path = write_audio(tmp_path / "clipped.wav", np.ones(40_000, dtype=np.float32))

    result = evaluate_guardrails(analyze_audio(path))

    assert result.accepted is False
    assert "clipping_ratio" in result.rejection_reasons
    assert "rms_too_high" in result.rejection_reasons


def test_guardrails_reject_excessive_silence_and_low_energy(tmp_path):
    path = write_audio(tmp_path / "silent.wav", np.zeros(40_000, dtype=np.float32))

    result = evaluate_guardrails(analyze_audio(path))

    assert result.accepted is False
    assert "silence_ratio" in result.rejection_reasons
    assert "rms_too_low" in result.rejection_reasons


@pytest.mark.parametrize(
    ("seconds", "reason"),
    [(0.5, "duration_truncated"), (1.5, "duration_expanded")],
)
def test_guardrails_reject_duration_pathology_against_reference(tmp_path, seconds, reason):
    reference = analyze_audio(write_audio(tmp_path / "reference.wav", sine(1.0)))
    candidate = analyze_audio(write_audio(tmp_path / "candidate.wav", sine(seconds)))

    result = evaluate_guardrails(candidate, reference=reference)

    assert result.accepted is False
    assert result.duration_ratio == pytest.approx(seconds)
    assert reason in result.rejection_reasons


def test_guardrails_reject_excessive_leading_or_trailing_silence(tmp_path):
    samples = np.concatenate(
        [
            np.zeros(24_000, dtype=np.float32),
            sine(0.4),
            np.zeros(24_000, dtype=np.float32),
        ],
    )
    path = write_audio(tmp_path / "padded.wav", samples)

    result = evaluate_guardrails(analyze_audio(path))

    assert result.accepted is False
    assert "leading_silence" in result.rejection_reasons
    assert "trailing_silence" in result.rejection_reasons


def test_guardrails_accept_clean_related_audio(tmp_path):
    reference = analyze_audio(write_audio(tmp_path / "reference.wav", sine(1.0)))
    candidate = analyze_audio(write_audio(tmp_path / "candidate.wav", sine(1.02)))

    result = evaluate_guardrails(candidate, reference=reference)

    assert result.accepted is True
    assert result.rejection_reasons == ()
    assert result.duration_ratio == pytest.approx(1.02)

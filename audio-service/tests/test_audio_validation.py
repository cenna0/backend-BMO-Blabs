from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.audio_validation import (
    AudioValidationError,
    validate_mp3_metadata,
    validate_rvc_wav,
)
from tests.helpers import write_wav_file


def write_float_wav(path: Path, samples: np.ndarray, sample_rate: int = 40_000) -> Path:
    sf.write(path, samples, sample_rate, format="WAV", subtype="FLOAT")
    return path


def test_validate_rvc_wav_accepts_finite_pcm_with_related_duration(tmp_path):
    input_wav = write_wav_file(tmp_path / "input.wav", frames=24_000)
    output_wav = write_wav_file(
        tmp_path / "output.wav",
        sample_rate=40_000,
        frames=40_000,
    )

    metadata = validate_rvc_wav(input_wav, output_wav, approved_dir=tmp_path)

    assert metadata.sample_rate == 40_000
    assert metadata.channels == 1
    assert metadata.duration_seconds == pytest.approx(1.0)
    assert metadata.peak_amplitude == 0.0


@pytest.mark.parametrize("content", [b"", b"not-a-wav"])
def test_validate_rvc_wav_rejects_empty_or_malformed_output(tmp_path, content):
    input_wav = write_wav_file(tmp_path / "input.wav", frames=24_000)
    output_wav = tmp_path / "output.wav"
    output_wav.write_bytes(content)

    with pytest.raises(AudioValidationError):
        validate_rvc_wav(input_wav, output_wav, approved_dir=tmp_path)


@pytest.mark.parametrize("value", [np.nan, np.inf, -np.inf])
def test_validate_rvc_wav_rejects_non_finite_samples(tmp_path, value):
    input_wav = write_wav_file(tmp_path / "input.wav", frames=24_000)
    samples = np.zeros(40_000, dtype=np.float32)
    samples[10] = value
    output_wav = write_float_wav(tmp_path / "output.wav", samples)

    with pytest.raises(AudioValidationError, match="finite"):
        validate_rvc_wav(input_wav, output_wav, approved_dir=tmp_path)


def test_validate_rvc_wav_rejects_pathological_amplitude(tmp_path):
    input_wav = write_wav_file(tmp_path / "input.wav", frames=24_000)
    output_wav = write_float_wav(
        tmp_path / "output.wav",
        np.full(40_000, 4.0, dtype=np.float32),
    )

    with pytest.raises(AudioValidationError, match="amplitude"):
        validate_rvc_wav(input_wav, output_wav, approved_dir=tmp_path)


def test_validate_rvc_wav_rejects_unreasonable_duration(tmp_path):
    input_wav = write_wav_file(tmp_path / "input.wav", frames=24_000)
    output_wav = write_wav_file(
        tmp_path / "output.wav",
        sample_rate=40_000,
        frames=200_000,
    )

    with pytest.raises(AudioValidationError, match="duration"):
        validate_rvc_wav(input_wav, output_wav, approved_dir=tmp_path)


def test_validate_rvc_wav_rejects_output_outside_approved_directory(tmp_path):
    approved = tmp_path / "approved"
    approved.mkdir()
    input_wav = write_wav_file(approved / "input.wav", frames=24_000)
    output_wav = write_wav_file(
        tmp_path / "escaped.wav",
        sample_rate=40_000,
        frames=40_000,
    )

    with pytest.raises(AudioValidationError, match="directory"):
        validate_rvc_wav(input_wav, output_wav, approved_dir=approved)


def test_validate_rvc_wav_rejects_symlink_output(tmp_path):
    input_wav = write_wav_file(tmp_path / "input.wav", frames=24_000)
    target = write_wav_file(
        tmp_path / "target.wav",
        sample_rate=40_000,
        frames=40_000,
    )
    output_wav = tmp_path / "output.wav"
    output_wav.symlink_to(target)

    with pytest.raises(AudioValidationError, match="regular"):
        validate_rvc_wav(input_wav, output_wav, approved_dir=tmp_path)


def test_validate_rvc_wav_rejects_file_over_size_limit(tmp_path):
    input_wav = write_wav_file(tmp_path / "input.wav", frames=24_000)
    output_wav = write_wav_file(
        tmp_path / "output.wav",
        sample_rate=40_000,
        frames=40_000,
    )

    with pytest.raises(AudioValidationError, match="size"):
        validate_rvc_wav(
            input_wav,
            output_wav,
            approved_dir=tmp_path,
            max_file_bytes=128,
        )


def test_validate_mp3_metadata_accepts_hardware_target():
    validate_mp3_metadata(
        {
            "codec": "mp3",
            "sample_rate": 24_000,
            "channels": 1,
            "bit_rate": 96_000,
            "duration": 1.25,
        },
        expected_sample_rate=24_000,
        expected_bitrate="96k",
    )


@pytest.mark.parametrize(
    "override",
    [
        {"codec": "aac"},
        {"sample_rate": 44_100},
        {"channels": 2},
        {"bit_rate": 48_000},
        {"duration": 0.0},
    ],
)
def test_validate_mp3_metadata_rejects_incompatible_output(override):
    metadata = {
        "codec": "mp3",
        "sample_rate": 24_000,
        "channels": 1,
        "bit_rate": 96_000,
        "duration": 1.25,
    }
    metadata.update(override)

    with pytest.raises(AudioValidationError):
        validate_mp3_metadata(
            metadata,
            expected_sample_rate=24_000,
            expected_bitrate="96k",
        )

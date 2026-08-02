from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import math
import stat

import numpy as np
import soundfile as sf


SILENCE_AMPLITUDE = 10 ** (-50 / 20)


class AudioMetricsError(ValueError):
    pass


@dataclass(frozen=True)
class AudioMetrics:
    sample_rate: int
    channels: int
    frames: int
    duration_seconds: float
    peak_amplitude: float
    rms_amplitude: float
    dc_offset: float
    clipping_ratio: float
    silence_ratio: float
    leading_silence_seconds: float
    trailing_silence_seconds: float
    spectral_flux_p95: float
    finite: bool


@dataclass(frozen=True)
class AudioGuardrailResult:
    accepted: bool
    rejection_reasons: tuple[str, ...]
    duration_ratio: float | None


def _regular_nonempty_file(path: Path) -> bool:
    try:
        details = path.lstat()
        return stat.S_ISREG(details.st_mode) and details.st_size > 0
    except OSError:
        return False


def _frame_signal(samples: np.ndarray, frame_length: int) -> np.ndarray:
    if samples.size == 0:
        return np.empty((0, frame_length), dtype=np.float32)
    frame_count = math.ceil(samples.size / frame_length)
    padded = np.pad(samples, (0, frame_count * frame_length - samples.size))
    return padded.reshape(frame_count, frame_length)


def _spectral_flux_p95(frames: np.ndarray) -> float:
    if frames.shape[0] < 2:
        return 0.0
    window = np.hanning(frames.shape[1]).astype(np.float32)
    spectra = np.abs(np.fft.rfft(frames * window, axis=1))
    totals = spectra.sum(axis=1, keepdims=True)
    normalized = np.divide(
        spectra,
        totals,
        out=np.zeros_like(spectra),
        where=totals > 1e-12,
    )
    flux = np.sqrt(np.mean(np.square(np.diff(normalized, axis=0)), axis=1))
    return float(np.percentile(flux, 95)) if flux.size else 0.0


def analyze_audio(path: Path) -> AudioMetrics:
    if not _regular_nonempty_file(path):
        raise AudioMetricsError("audio is not parseable")
    try:
        samples, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    except (OSError, RuntimeError, ValueError) as error:
        raise AudioMetricsError("audio is not parseable") from error
    if samples.size == 0 or sample_rate <= 0 or samples.shape[0] <= 0:
        raise AudioMetricsError("audio is not parseable")
    if not np.isfinite(samples).all():
        raise AudioMetricsError("audio samples are not finite")

    mono = samples.mean(axis=1, dtype=np.float64).astype(np.float32)
    absolute = np.abs(samples.astype(np.float64))
    frame_length = max(1, sample_rate // 50)
    frames = _frame_signal(mono, frame_length)
    frame_rms = np.sqrt(np.mean(np.square(frames, dtype=np.float64), axis=1))
    silent_frames = frame_rms <= SILENCE_AMPLITUDE
    leading_frames = 0
    for silent in silent_frames:
        if not silent:
            break
        leading_frames += 1
    trailing_frames = 0
    for silent in silent_frames[::-1]:
        if not silent:
            break
        trailing_frames += 1

    frame_seconds = frame_length / sample_rate
    return AudioMetrics(
        sample_rate=int(sample_rate),
        channels=int(samples.shape[1]),
        frames=int(samples.shape[0]),
        duration_seconds=float(samples.shape[0] / sample_rate),
        peak_amplitude=float(absolute.max()),
        rms_amplitude=float(np.sqrt(np.mean(np.square(samples, dtype=np.float64)))),
        dc_offset=float(np.mean(samples, dtype=np.float64)),
        clipping_ratio=float(np.mean(absolute >= 0.999)),
        silence_ratio=float(np.mean(silent_frames)),
        leading_silence_seconds=float(leading_frames * frame_seconds),
        trailing_silence_seconds=float(trailing_frames * frame_seconds),
        spectral_flux_p95=_spectral_flux_p95(frames),
        finite=True,
    )


def evaluate_guardrails(
    candidate: AudioMetrics,
    *,
    reference: AudioMetrics | None = None,
) -> AudioGuardrailResult:
    reasons: list[str] = []
    duration_ratio: float | None = None
    if not candidate.finite or candidate.duration_seconds <= 0:
        reasons.append("invalid_duration_or_samples")
    if candidate.peak_amplitude > 1.05:
        reasons.append("peak_too_high")
    if candidate.clipping_ratio > 0.005:
        reasons.append("clipping_ratio")
    if candidate.rms_amplitude < 0.003:
        reasons.append("rms_too_low")
    if candidate.rms_amplitude > 0.5:
        reasons.append("rms_too_high")
    if abs(candidate.dc_offset) > 0.1:
        reasons.append("dc_offset")
    if candidate.silence_ratio > 0.75:
        reasons.append("silence_ratio")

    maximum_edge_silence = max(0.25, candidate.duration_seconds * 0.35)
    if candidate.leading_silence_seconds > maximum_edge_silence:
        reasons.append("leading_silence")
    if candidate.trailing_silence_seconds > maximum_edge_silence:
        reasons.append("trailing_silence")

    if reference is not None and reference.duration_seconds > 0:
        duration_ratio = candidate.duration_seconds / reference.duration_seconds
        if duration_ratio < 0.7:
            reasons.append("duration_truncated")
        elif duration_ratio > 1.35:
            reasons.append("duration_expanded")

    return AudioGuardrailResult(
        accepted=not reasons,
        rejection_reasons=tuple(reasons),
        duration_ratio=duration_ratio,
    )

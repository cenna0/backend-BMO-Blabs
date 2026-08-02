#!/usr/bin/env python3
from __future__ import annotations

from argparse import ArgumentParser
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import sys
from typing import Protocol

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.audio_metrics import analyze_audio, evaluate_guardrails
from app.audio_validation import validate_rvc_wav
from app.config import Settings
from app.ffmpeg import FfmpegConverter, probe_audio
from app.kokoro_tts import KokoroSynthesizer


@dataclass(frozen=True)
class QualityPhrase:
    identifier: str
    category: str
    text: str


PHRASES = (
    QualityPhrase("01-ready", "short", "Hi! BMO is ready to help."),
    QualityPhrase("02-reassure", "short", "Do not worry. BMO is right here with you."),
    QualityPhrase("03-yay", "short", "Yay! BMO found the answer."),
    QualityPhrase(
        "04-calm",
        "calm-medium",
        "Take a slow breath. BMO will stay with you while we work through this together.",
    ),
    QualityPhrase(
        "05-excited",
        "excited-medium",
        "Great news! BMO solved the puzzle, and the next adventure is ready to begin!",
    ),
    QualityPhrase(
        "06-details",
        "numbers-names-punctuation",
        "Finn, Jake, and BMO counted 3 batteries, 12 stars, and 42 tiny robots. Wow!",
    ),
    QualityPhrase(
        "07-long",
        "long-expected",
        "BMO checked the map and found a safe path through the forest. Pack two sandwiches, one flashlight, and your favorite blue blanket. We can leave after the rain stops.",
    ),
)


class KokoroLike(Protocol):
    def synthesize_to_wav(self, text: str, output_path: Path) -> float:
        ...


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _audio_file_record(path: Path, *, include_probe: bool = False) -> dict[str, object]:
    record: dict[str, object] = {
        "filename": path.name,
        "bytes": path.stat().st_size,
        "sha256": _sha256(path),
        "metrics": asdict(analyze_audio(path)),
    }
    if include_probe:
        record["probe"] = probe_audio(path)
    return record


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def generate_references(
    settings: Settings,
    output_dir: Path,
    *,
    kokoro: KokoroLike | None = None,
) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    resolved_kokoro = kokoro or KokoroSynthesizer(settings)
    ffmpeg = FfmpegConverter(settings)
    samples: list[dict[str, object]] = []
    for phrase in PHRASES:
        wav = output_dir / f"{phrase.identifier}.wav"
        mp3 = output_dir / f"{phrase.identifier}.mp3"
        wav.unlink(missing_ok=True)
        mp3.unlink(missing_ok=True)
        kokoro_seconds = resolved_kokoro.synthesize_to_wav(phrase.text, wav)
        ffmpeg_seconds = ffmpeg.convert_wav_to_mp3(wav, mp3)
        samples.append(
            {
                "id": phrase.identifier,
                "category": phrase.category,
                "text": phrase.text,
                "kokoro_seconds": kokoro_seconds,
                "ffmpeg_seconds": ffmpeg_seconds,
                "wav": _audio_file_record(wav),
                "mp3": _audio_file_record(mp3, include_probe=True),
            },
        )
    payload: dict[str, object] = {
        "status": "references_ready",
        "configuration": {"lang_code": "a", "voice": "af_heart", "speed": 0.8},
        "samples": samples,
    }
    _write_json(output_dir / "references.json", payload)
    return payload


def analyze_candidate(
    settings: Settings,
    *,
    reference_wav: Path,
    candidate_wav: Path,
    output_mp3: Path,
    record_path: Path,
    parameters: dict[str, object],
) -> dict[str, object]:
    validate_rvc_wav(reference_wav, candidate_wav, approved_dir=candidate_wav.parent)
    output_mp3.unlink(missing_ok=True)
    ffmpeg_seconds = FfmpegConverter(settings).convert_wav_to_mp3(candidate_wav, output_mp3)
    reference_metrics = analyze_audio(reference_wav)
    candidate_metrics = analyze_audio(candidate_wav)
    payload: dict[str, object] = {
        "status": "candidate_accepted",
        "parameters": parameters,
        "ffmpeg_seconds": ffmpeg_seconds,
        "wav": _audio_file_record(candidate_wav),
        "mp3": _audio_file_record(output_mp3, include_probe=True),
        "guardrails": asdict(
            evaluate_guardrails(candidate_metrics, reference=reference_metrics),
        ),
    }
    if not payload["guardrails"]["accepted"]:  # type: ignore[index]
        payload["status"] = "candidate_rejected"
    _write_json(record_path, payload)
    return payload


def write_bundle_manifest(bundle_root: Path, configurations: dict[str, object]) -> dict[str, object]:
    reference_dir = bundle_root / "reference-kokoro"
    samples: list[dict[str, object]] = []
    for phrase in PHRASES:
        reference_wav = reference_dir / f"{phrase.identifier}.wav"
        reference_metrics = analyze_audio(reference_wav)
        variants: dict[str, object] = {}
        for label in ("reference-kokoro", *configurations.keys()):
            directory = bundle_root / label
            wav = directory / f"{phrase.identifier}.wav"
            mp3 = directory / f"{phrase.identifier}.mp3"
            variant: dict[str, object] = {
                "wav": _audio_file_record(wav),
                "mp3": _audio_file_record(mp3, include_probe=True),
            }
            if label != "reference-kokoro":
                variant["guardrails"] = asdict(
                    evaluate_guardrails(analyze_audio(wav), reference=reference_metrics),
                )
            variants[label] = variant
        samples.append(
            {
                "id": phrase.identifier,
                "category": phrase.category,
                "text": phrase.text,
                "variants": variants,
            },
        )
    payload: dict[str, object] = {
        "status": "awaiting_operator_listening",
        "automated_metrics_are_guardrails_only": True,
        "configurations": configurations,
        "samples": samples,
    }
    _write_json(bundle_root / "manifest.json", payload)
    guide = """# P8 RVC Operator Listening Guide

This bundle has not received subjective quality approval. Automated metrics only
screened for technical corruption.

For each numbered phrase, compare `reference-kokoro` with the blind-friendly
candidate labels. Listen for intelligibility, BMO likeness, consonant stability,
pitch consistency, metallic/buzzy artifacts, clipping, missing words, and whether
calm/excited delivery remains appropriate. Use headphones and then a small speaker.

Record an explicit accept/reject and notes for every candidate. Do not infer the
parameters from filenames; exact settings are in `manifest.json` after scoring.
"""
    (bundle_root / "LISTENING-GUIDE.md").write_text(guide, encoding="utf-8")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = ArgumentParser(description="Build isolated P8 RVC quality evidence")
    subparsers = parser.add_subparsers(dest="action", required=True)
    references = subparsers.add_parser("references")
    references.add_argument("--output-dir", type=Path, required=True)
    candidate = subparsers.add_parser("candidate")
    candidate.add_argument("--reference-wav", type=Path, required=True)
    candidate.add_argument("--candidate-wav", type=Path, required=True)
    candidate.add_argument("--output-mp3", type=Path, required=True)
    candidate.add_argument("--record", type=Path, required=True)
    candidate.add_argument("--parameters-json", required=True)
    bundle = subparsers.add_parser("bundle")
    bundle.add_argument("--bundle-root", type=Path, required=True)
    bundle.add_argument("--configurations-json", required=True)
    args = parser.parse_args(argv)
    settings = Settings()
    if args.action == "references":
        payload = generate_references(settings, args.output_dir)
    elif args.action == "candidate":
        payload = analyze_candidate(
            settings,
            reference_wav=args.reference_wav,
            candidate_wav=args.candidate_wav,
            output_mp3=args.output_mp3,
            record_path=args.record,
            parameters=json.loads(args.parameters_json),
        )
    else:
        payload = write_bundle_manifest(
            args.bundle_root,
            json.loads(args.configurations_json),
        )
    print(json.dumps(payload, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

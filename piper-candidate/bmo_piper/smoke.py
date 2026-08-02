from __future__ import annotations

from pathlib import Path
import argparse
import json
import shutil
import time

from .audio import validate_mp3, validate_wav
from .engine import PiperEngine
from .ffmpeg import convert_wav_to_mp3
from .shutdown import ShutdownRequested, install_shutdown_handlers


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--results", type=Path, required=True)
    args = parser.parse_args()
    install_shutdown_handlers()
    output_root = args.output_root.resolve(strict=True)
    raw_root = output_root / "smoke" / "raw"
    validated_root = output_root / "smoke" / "validated"
    mp3_root = output_root / "smoke" / "mp3"
    for root in (raw_root, validated_root, mp3_root):
        root.mkdir(parents=True, exist_ok=True)
    raw_path = raw_root / "prudence-smoke.wav"
    validated_path = validated_root / "prudence-smoke.wav"
    mp3_path = mp3_root / "prudence-smoke.mp3"
    for path in (raw_path, validated_path, mp3_path):
        path.unlink(missing_ok=True)
    process_started = time.perf_counter()
    engine = PiperEngine(args.manifest, output_root)
    ready_seconds = time.perf_counter() - process_started
    synthesis = engine.synthesize(args.text, raw_path, "prudence", 0)
    raw_metrics = validate_wav(raw_path, expected_sample_rate=22050)
    shutil.copyfile(raw_path, validated_path)
    validated_metrics = validate_wav(validated_path, expected_sample_rate=22050)
    ffmpeg_seconds = convert_wav_to_mp3(validated_path, mp3_path)
    mp3_metrics = validate_mp3(mp3_path)
    result = {
        "process_start_and_model_load_seconds": ready_seconds,
        "model_load_seconds": engine.load_seconds,
        "synthesis": synthesis,
        "ffmpeg_seconds": ffmpeg_seconds,
        "raw_wav": {"path": str(raw_path), **raw_metrics},
        "validated_wav": {"path": str(validated_path), **validated_metrics},
        "final_mp3": {"path": str(mp3_path), **mp3_metrics},
        "speaker_name": engine.identity.speaker_name,
        "speaker_id": engine.identity.speaker_id,
        "model_sha256": engine.identity.model_sha256,
        "config_sha256": engine.identity.config_sha256,
    }
    args.results.write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ShutdownRequested:
        raise SystemExit(0) from None

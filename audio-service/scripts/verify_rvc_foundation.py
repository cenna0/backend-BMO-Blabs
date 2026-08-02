#!/usr/bin/env python3
from __future__ import annotations

from argparse import ArgumentParser
from dataclasses import asdict
import gc
import json
from pathlib import Path
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.audio_validation import validate_mp3_metadata, validate_rvc_wav
from app.config import Settings
from app.ffmpeg import FfmpegConverter, probe_audio
from app.kokoro_tts import KokoroSynthesizer
from app.rvc import RvcCommandConverter
from app.tts import TtsOrchestrator


SMOKE_TEXT = "Hi! BMO is ready to help."


class PrebuiltKokoro:
    ready = True

    def __init__(self, source: Path) -> None:
        self._source = source

    def synthesize_to_wav(self, _text: str, output_path: Path) -> float:
        shutil.copyfile(self._source, output_path)
        return 0.0


def file_count(path: Path) -> int:
    return sum(item.is_file() for item in path.rglob("*")) if path.exists() else 0


def main(argv: list[str] | None = None) -> int:
    parser = ArgumentParser(description="Run one isolated P8 RVC foundation smoke inference")
    parser.add_argument("--runtime-models", type=Path, required=True)
    parser.add_argument("--rvc-models", type=Path, required=True)
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    args = parser.parse_args(argv)

    listening = args.evidence_dir / "listening"
    work = args.evidence_dir / "work"
    listening.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    kokoro_wav = listening / "p8-foundation-kokoro.wav"
    rvc_wav = listening / "p8-foundation-rvc.wav"
    rvc_mp3 = listening / "p8-foundation-rvc.mp3"
    fallback_mp3 = listening / "p8-foundation-forced-fallback.mp3"
    for path in (kokoro_wav, rvc_wav, rvc_mp3, fallback_mp3):
        path.unlink(missing_ok=True)

    settings = Settings(
        internal_service_token="p8-isolated-sentinel-token",
        runtime_models_root=args.runtime_models,
        model_download_allowed=False,
        hf_home=args.cache_dir / "huggingface",
        torch_home=args.cache_dir / "torch",
        xdg_cache_home=args.cache_dir / "xdg",
        tts_temp_dir=listening,
        rvc_enabled=True,
        rvc_model_path=args.rvc_models / "rvc/bmo/assets/CGO_e420_s2520.pth",
        rvc_index_path=args.rvc_models / "rvc/bmo/assets/added_IVF69_Flat_nprobe_1_CGO_v2.index",
        rvc_hubert_path=args.rvc_models / "rvc/support/hubert_base.pt",
        rvc_rmvpe_path=args.rvc_models / "rvc/support/rmvpe.pt",
        rvc_manifest_path=args.rvc_models / "MODEL_MANIFEST.rvc.json",
        rvc_infer_command="/opt/rvc-venv/bin/python /app/scripts/rvc_infer.py",
        rvc_f0_up_key=0,
        rvc_f0_method="rmvpe",
        rvc_timeout_seconds=120,
    )
    cache_before = file_count(args.cache_dir)
    total_started = time.perf_counter()
    kokoro = KokoroSynthesizer(settings)
    ffmpeg = FfmpegConverter(settings)
    rvc = RvcCommandConverter(settings)

    kokoro_seconds = kokoro.synthesize_to_wav(SMOKE_TEXT, kokoro_wav)
    # This foundation smoke measures the stages sequentially. Prompt 2 owns the
    # co-resident production resource benchmark.
    del kokoro
    gc.collect()
    rvc_seconds = rvc.convert(kokoro_wav, rvc_wav)
    rvc_metadata = validate_rvc_wav(kokoro_wav, rvc_wav, approved_dir=listening)
    ffmpeg_seconds = ffmpeg.convert_wav_to_mp3(rvc_wav, rvc_mp3)
    mp3_metadata = probe_audio(rvc_mp3, ffprobe_binary=settings.ffprobe_binary)
    validate_mp3_metadata(
        mp3_metadata,
        expected_sample_rate=settings.output_mp3_sample_rate,
        expected_bitrate=settings.output_mp3_bitrate,
    )

    forced_rvc = RvcCommandConverter(
        settings,
        command_override=("/bin/false",),
        manifest_verifier=lambda _manifest, _paths: None,
    )
    fallback_orchestrator = TtsOrchestrator(
        settings=settings,
        kokoro=PrebuiltKokoro(kokoro_wav),
        ffmpeg=ffmpeg,
        rvc=forced_rvc,
    )
    fallback_result = fallback_orchestrator.synthesize(SMOKE_TEXT, use_rvc=True)
    fallback_mp3.write_bytes(fallback_result.audio)
    fallback_metadata = probe_audio(fallback_mp3, ffprobe_binary=settings.ffprobe_binary)
    validate_mp3_metadata(
        fallback_metadata,
        expected_sample_rate=settings.output_mp3_sample_rate,
        expected_bitrate=settings.output_mp3_bitrate,
    )
    remaining_request_dirs = sorted(path.name for path in listening.glob("bmo-tts-*"))
    payload = {
        "status": "pass",
        "text": SMOKE_TEXT,
        "parameters": {
            "device": "cpu",
            "f0_up_key": settings.rvc_f0_up_key,
            "f0_method": settings.rvc_f0_method,
            "index_configured": settings.rvc_index_path is not None,
            "timeout_seconds": settings.rvc_timeout_seconds,
        },
        "timings_seconds": {
            "kokoro": kokoro_seconds,
            "rvc": rvc_seconds,
            "ffmpeg": ffmpeg_seconds,
            "total_including_manifest_and_fallback": round(time.perf_counter() - total_started, 3),
        },
        "rvc_wav": {**asdict(rvc_metadata), "path": str(rvc_wav), "bytes": rvc_wav.stat().st_size},
        "rvc_mp3": {**mp3_metadata, "path": str(rvc_mp3), "bytes": rvc_mp3.stat().st_size},
        "fallback": {
            **fallback_metadata,
            "path": str(fallback_mp3),
            "bytes": fallback_mp3.stat().st_size,
            "rvc_applied": fallback_result.rvc_applied,
            "engine": fallback_result.engine,
            "request_succeeded": True,
        },
        "temp_request_dirs_remaining": remaining_request_dirs,
        "cache_files_before": cache_before,
        "cache_files_after": file_count(args.cache_dir),
    }
    if fallback_result.rvc_applied or remaining_request_dirs:
        payload["status"] = "fail"
    results = args.evidence_dir / "p8-foundation-smoke.json"
    results.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(payload, sort_keys=True))
    return 0 if payload["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())

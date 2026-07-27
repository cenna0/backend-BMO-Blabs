#!/usr/bin/env python3
from __future__ import annotations

from argparse import ArgumentParser
import json
from pathlib import Path
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import Settings
from app.ffmpeg import FfmpegConverter, probe_audio
from app.kokoro_tts import KokoroSynthesizer
from app.rvc import RVC_RELATIVE_DIR, RvcCommandConverter
from app.tts import TtsEngineState, TtsOrchestrator


SENTENCES = [
    "Hi! BMO is ready to help.",
    "Do not worry. BMO is right here with you.",
    "Yay! BMO found the answer.",
]


class ForcedFailureRvc:
    available = True
    error = "forced verification failure"

    def convert(self, input_wav: Path, output_wav: Path) -> float:
        raise RuntimeError("forced RVC failure for fallback verification")


def cache_stats(path: Path) -> dict[str, int]:
    if not path.exists():
        return {"file_count": 0, "bytes": 0}
    files = [item for item in path.rglob("*") if item.is_file()]
    return {"file_count": len(files), "bytes": sum(item.stat().st_size for item in files)}


def discover_single_asset(directory: Path, suffix: str) -> Path | None:
    matches = sorted(directory.glob(f"*{suffix}"))
    if len(matches) == 1:
        return matches[0]
    return None


def endpoint_health_status(stt_ready: bool, state: TtsEngineState) -> str:
    if stt_ready and state.kokoro_loaded and state.ffmpeg_available:
        return "ok" if state.rvc_available else "degraded"
    return "error"


def verify_mode(
    *,
    text: str,
    mode: str,
    orchestrator: TtsOrchestrator,
    output_path: Path,
    ffprobe_binary: str,
) -> dict[str, object]:
    started = time.perf_counter()
    result = orchestrator.synthesize(text, use_rvc=mode == "kokoro-rvc")
    generation_seconds = round(time.perf_counter() - started, 3)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(result.audio)
    metadata = probe_audio(output_path, ffprobe_binary=ffprobe_binary)
    pass_status = (
        metadata["codec"] == "mp3"
        and metadata["sample_rate"] == 24_000
        and metadata["channels"] == 1
        and 80_000 <= metadata["bit_rate"] <= 112_000
        and output_path.stat().st_size > 0
        and (mode == "kokoro-only" or result.rvc_applied)
    )
    return {
        "text": text,
        "output_mode": mode,
        "output_path": str(output_path),
        "duration": metadata["duration"],
        "generation_seconds": generation_seconds,
        "kokoro_seconds": result.kokoro_seconds,
        "rvc_seconds": result.rvc_seconds,
        "ffmpeg_seconds": result.ffmpeg_seconds,
        "output_size": output_path.stat().st_size,
        "codec": metadata["codec"],
        "sample_rate": metadata["sample_rate"],
        "channels": metadata["channels"],
        "bit_rate": metadata["bit_rate"],
        "rvc_applied": result.rvc_applied,
        "pass": pass_status,
    }


def main() -> int:
    parser = ArgumentParser(description="Verify real Kokoro/FFmpeg/RVC P3 voice pipeline.")
    parser.add_argument("--models-dir", type=Path, default=Path("models"))
    parser.add_argument("--temp-dir", type=Path, default=Path("temp/p3-real-voice"))
    parser.add_argument("--results", type=Path, default=Path("temp/p3-real-voice-results.json"))
    args = parser.parse_args()

    output_dir = args.temp_dir / "outputs"
    work_dir = args.temp_dir / "work"
    if output_dir.exists():
        shutil.rmtree(output_dir)
    if work_dir.exists():
        shutil.rmtree(work_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    rvc_assets_dir = args.models_dir / RVC_RELATIVE_DIR / "assets"
    discovered_model = discover_single_asset(rvc_assets_dir, ".pth")
    discovered_index = discover_single_asset(rvc_assets_dir, ".index")

    settings = Settings(
        internal_service_token="voice-verification-token",
        hf_home=args.models_dir / "hf-cache",
        torch_home=args.models_dir / "torch-cache",
        tts_temp_dir=work_dir,
        rvc_model_path=discovered_model,
        rvc_index_path=discovered_index,
    )
    before_cache = {
        "kokoro": cache_stats(args.models_dir / "hf-cache"),
        "rvc": cache_stats(args.models_dir / RVC_RELATIVE_DIR),
    }

    kokoro = KokoroSynthesizer(settings)
    ffmpeg = FfmpegConverter(settings)
    rvc = RvcCommandConverter(settings)
    orchestrator = TtsOrchestrator(settings=settings, kokoro=kokoro, ffmpeg=ffmpeg, rvc=rvc)

    kokoro_only = [
        verify_mode(
            text=text,
            mode="kokoro-only",
            orchestrator=orchestrator,
            output_path=output_dir / f"sentence-{index}-kokoro.mp3",
            ffprobe_binary=settings.ffprobe_binary,
        )
        for index, text in enumerate(SENTENCES, start=1)
    ]

    rvc_results: list[dict[str, object]] = []
    real_rvc_available = rvc.available
    if real_rvc_available:
        rvc_results = [
            verify_mode(
                text=text,
                mode="kokoro-rvc",
                orchestrator=orchestrator,
                output_path=output_dir / f"sentence-{index}-kokoro-rvc.mp3",
                ffprobe_binary=settings.ffprobe_binary,
            )
            for index, text in enumerate(SENTENCES, start=1)
        ]

    forced_fallback_orchestrator = TtsOrchestrator(
        settings=settings,
        kokoro=kokoro,
        ffmpeg=ffmpeg,
        rvc=ForcedFailureRvc(),
    )
    forced_fallback = verify_mode(
        text=SENTENCES[0],
        mode="kokoro-only",
        orchestrator=forced_fallback_orchestrator,
        output_path=output_dir / "forced-rvc-fallback.mp3",
        ffprobe_binary=settings.ffprobe_binary,
    )
    forced_fallback["forced_rvc_failure"] = True
    forced_fallback["pass"] = forced_fallback["pass"] and forced_fallback["rvc_applied"] is False

    health_after_kokoro = orchestrator.health_state()
    health_states = {
        "ok_if_rvc_ready": endpoint_health_status(True, TtsEngineState(True, True, True, None)),
        "degraded_if_rvc_unavailable": endpoint_health_status(True, TtsEngineState(True, True, False, "RVC unavailable")),
        "error_if_kokoro_missing": endpoint_health_status(True, TtsEngineState(False, True, False, None)),
        "actual_after_run": endpoint_health_status(True, health_after_kokoro),
    }
    after_cache = {
        "kokoro": cache_stats(args.models_dir / "hf-cache"),
        "rvc": cache_stats(args.models_dir / RVC_RELATIVE_DIR),
    }
    temp_remaining = [str(path) for path in work_dir.rglob("*") if path.is_file()]

    kokoro_ffmpeg_pass = all(item["pass"] for item in kokoro_only) and forced_fallback["pass"] and not temp_remaining
    real_rvc_pass = bool(rvc_results) and all(item["pass"] for item in rvc_results)
    payload = {
        "model": {
            "kokoro_language": settings.kokoro_lang_code,
            "kokoro_voice": settings.kokoro_voice,
            "kokoro_sample_rate": settings.kokoro_sample_rate,
            "output_mp3_sample_rate": settings.output_mp3_sample_rate,
            "output_mp3_bitrate": settings.output_mp3_bitrate,
            "rvc_available": real_rvc_available,
            "rvc_error": rvc.error,
            "rvc_model_path": str(settings.rvc_model_path) if settings.rvc_model_path else None,
            "rvc_index_path": str(settings.rvc_index_path) if settings.rvc_index_path else None,
            "rvc_f0_up_key": settings.rvc_f0_up_key,
            "rvc_f0_method": settings.rvc_f0_method,
        },
        "cache_before": before_cache,
        "cache_after": after_cache,
        "kokoro_only": kokoro_only,
        "kokoro_rvc": rvc_results,
        "forced_fallback": forced_fallback,
        "health_states": health_states,
        "temp_remaining": temp_remaining,
        "kokoro_ffmpeg_pass": kokoro_ffmpeg_pass,
        "real_rvc_pass": real_rvc_pass,
        "p3_verified_local_functional": kokoro_ffmpeg_pass and real_rvc_pass,
    }
    args.results.parent.mkdir(parents=True, exist_ok=True)
    args.results.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))
    return 0 if kokoro_ffmpeg_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())

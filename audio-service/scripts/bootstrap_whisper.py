#!/usr/bin/env python3
from __future__ import annotations

from argparse import ArgumentParser
from datetime import datetime, timezone
from pathlib import Path
import json
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import Settings


def build_manifest(settings: Settings, status: str) -> dict[str, object]:
    return {
        "status": status,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "whisper_model": settings.whisper_model,
        "whisper_device": settings.whisper_device,
        "whisper_compute_type": settings.whisper_compute_type,
        "whisper_cpu_threads": settings.whisper_cpu_threads,
        "whisper_workers": settings.whisper_workers,
        "whisper_beam_size": settings.whisper_beam_size,
        "whisper_vad": settings.whisper_vad,
        "hf_home": str(settings.hf_home),
        "torch_home": str(settings.torch_home),
    }


def main() -> int:
    parser = ArgumentParser(description="Bootstrap/cache faster-whisper model for BMO P2.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-download", action="store_true")
    parser.add_argument("--models-dir", type=Path, default=Path("/opt/bmo-mvp/models"))
    parser.add_argument("--manifest", type=Path, default=Path("MODEL_MANIFEST.json"))
    args = parser.parse_args()

    settings = Settings(
        internal_service_token=os.environ.get("INTERNAL_SERVICE_TOKEN", "bootstrap-token-000"),
        hf_home=args.models_dir / "hf-cache",
        torch_home=args.models_dir / "torch-cache",
    )
    args.manifest.parent.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        args.manifest.write_text(
            json.dumps(build_manifest(settings, "dry_run"), indent=2) + "\n",
            encoding="utf-8",
        )
        print(json.dumps({"status": "dry_run", "manifest": str(args.manifest)}))
        return 0

    if not args.allow_download and not settings.model_download_allowed:
        print("model download disabled; rerun with --allow-download after approval", file=sys.stderr)
        return 2

    os.environ["HF_HOME"] = str(settings.hf_home)
    os.environ["TORCH_HOME"] = str(settings.torch_home)
    settings.hf_home.mkdir(parents=True, exist_ok=True)
    settings.torch_home.mkdir(parents=True, exist_ok=True)

    from app.stt import FasterWhisperTranscriber

    transcriber = FasterWhisperTranscriber(settings)
    transcriber._load_model()
    args.manifest.write_text(
        json.dumps(build_manifest(settings, "model_loaded"), indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"status": "model_loaded", "manifest": str(args.manifest)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations

from argparse import ArgumentParser
import asyncio
import json
import math
from pathlib import Path
import random
import subprocess
import sys
import threading
import time
import wave

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.model_assets import WHISPER_SPEC, runtime_snapshot_path
from app.stt import FasterWhisperTranscriber
from app.wav import inspect_wav


FIXTURES = {
    "english": {
        "voice": "en-US-JennyNeural",
        "text": "Hello BMO, please help me remember the meeting tomorrow.",
        "expect_speech": True,
    },
    "indonesian": {
        "voice": "id-ID-GadisNeural",
        "text": "Halo BMO, tolong bantu aku mengingat jadwal hari ini.",
        "expect_speech": True,
    },
    "mixed": {
        "voice": "id-ID-GadisNeural",
        "text": "BMO, tolong remind aku about the meeting tomorrow.",
        "expect_speech": True,
    },
    "silence": {
        "expect_speech": False,
    },
    "noise": {
        "expect_speech": False,
    },
}


def run_command(command: list[str]) -> None:
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"command failed ({result.returncode}): {' '.join(command)}\n{result.stderr}",
        )


async def synthesize_edge_tts(text: str, voice: str, output: Path) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(str(output))


def write_silence(path: Path, duration_seconds: float = 2.0) -> None:
    frame_count = int(16_000 * duration_seconds)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16_000)
        wav.writeframes(b"\x00\x00" * frame_count)


def write_noise(path: Path, duration_seconds: float = 2.0) -> None:
    frame_count = int(16_000 * duration_seconds)
    rng = random.Random(20260719)
    frames = bytearray()
    for index in range(frame_count):
        carrier = math.sin(index / 17.0) * 180
        sample = int(carrier + rng.randint(-90, 90))
        frames += sample.to_bytes(2, "little", signed=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16_000)
        wav.writeframes(bytes(frames))


def convert_to_canonical_wav(source: Path, target: Path) -> None:
    run_command(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(source),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-sample_fmt",
            "s16",
            str(target),
        ],
    )


def prepare_fixtures(fixtures_dir: Path, skip_generate: bool) -> dict[str, Path]:
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for name, spec in FIXTURES.items():
        wav_path = fixtures_dir / f"{name}.wav"
        paths[name] = wav_path
        if skip_generate and wav_path.exists():
            continue
        if name == "silence":
            write_silence(wav_path)
        elif name == "noise":
            write_noise(wav_path)
        else:
            mp3_path = fixtures_dir / f"{name}.mp3"
            asyncio.run(synthesize_edge_tts(spec["text"], spec["voice"], mp3_path))
            convert_to_canonical_wav(mp3_path, wav_path)
        inspect_wav(wav_path.read_bytes())
    return paths


def model_cache_metadata(models_dir: Path, model_name: str) -> dict[str, object]:
    del model_name
    snapshot = runtime_snapshot_path(models_dir / "runtime", WHISPER_SPEC)
    runtime_root = models_dir / "runtime"
    files = [path for path in snapshot.rglob("*") if path.is_file()]
    return {
        "source": WHISPER_SPEC.repository,
        "revision": WHISPER_SPEC.revision,
        "cache_dir": str(runtime_root),
        "file_count": len(files),
        "total_bytes": sum(path.stat().st_size for path in files),
        "snapshot_dir": str(snapshot),
    }


class MemorySampler:
    def __init__(self) -> None:
        import psutil

        self._process = psutil.Process()
        self.peak_rss_bytes = self._process.memory_info().rss
        self._running = False
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._running = True
        self._thread = threading.Thread(target=self._sample, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=1)

    def _sample(self) -> None:
        while self._running:
            self.peak_rss_bytes = max(self.peak_rss_bytes, self._process.memory_info().rss)
            time.sleep(0.05)


def transcribe_fixture(client: TestClient, token: str, name: str, path: Path) -> dict[str, object]:
    metadata = inspect_wav(path.read_bytes())
    sampler = MemorySampler()
    sampler.start()
    started = time.perf_counter()
    response = client.post(
        "/stt/transcribe",
        content=path.read_bytes(),
        headers={
            "content-type": "audio/wav",
            "x-internal-service-token": token,
        },
    )
    duration = time.perf_counter() - started
    sampler.stop()
    body = response.json()
    expect_speech = bool(FIXTURES[name]["expect_speech"])
    text = str(body.get("text", "")).strip()
    pass_status = (
        response.status_code == 200
        and bool(body.get("speech_detected")) == expect_speech
        and ((bool(text) and expect_speech) or (not text and not expect_speech))
    )
    return {
        "fixture": path.name,
        "duration_seconds": metadata.duration_seconds,
        "http_status": response.status_code,
        "transcript": text,
        "detected_language": body.get("language"),
        "language_probability": body.get("language_probability"),
        "speech_detected": body.get("speech_detected"),
        "inference_duration_seconds": round(duration, 3),
        "peak_rss_bytes": sampler.peak_rss_bytes,
        "pass": pass_status,
    }


def main() -> int:
    parser = ArgumentParser(description="Verify real faster-whisper inference through /stt/transcribe.")
    parser.add_argument("--models-dir", type=Path, default=Path("models"))
    parser.add_argument("--fixtures-dir", type=Path, default=Path("temp/real-inference-fixtures"))
    parser.add_argument("--results", type=Path, default=Path("temp/p2-real-inference-results.json"))
    parser.add_argument("--skip-generate", action="store_true")
    args = parser.parse_args()

    token = "real-inference-token"
    paths = prepare_fixtures(args.fixtures_dir, args.skip_generate)
    settings = Settings(
        internal_service_token=token,
        hf_home=args.models_dir / "hf-cache",
        torch_home=args.models_dir / "torch-cache",
    )
    transcriber = FasterWhisperTranscriber(settings)
    load_started = time.perf_counter()
    transcriber._load_model()
    model_load_seconds = round(time.perf_counter() - load_started, 3)
    app = create_app(settings=settings, transcriber=transcriber)

    with TestClient(app) as client:
        health = client.get("/health").json()
        results = [transcribe_fixture(client, token, name, path) for name, path in paths.items()]

    payload = {
        "model": {
            "name": settings.whisper_model,
            "device": settings.whisper_device,
            "compute_type": settings.whisper_compute_type,
            "language": "auto-detect",
            "task": "transcribe",
            "vad": settings.whisper_vad,
            "beam_size": settings.whisper_beam_size,
            "transcriber_class": type(transcriber).__name__,
            "load_seconds": model_load_seconds,
            **model_cache_metadata(args.models_dir, settings.whisper_model),
        },
        "health_after_load": health,
        "fixtures": results,
        "all_pass": all(result["pass"] for result in results),
    }
    args.results.parent.mkdir(parents=True, exist_ok=True)
    args.results.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))
    return 0 if payload["all_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

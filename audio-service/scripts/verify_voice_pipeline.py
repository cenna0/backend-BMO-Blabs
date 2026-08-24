#!/usr/bin/env python3
"""Verify the deployed candidate Audio Service over its HTTP contract."""

from __future__ import annotations

from argparse import ArgumentParser
import json
from pathlib import Path
import subprocess
import sys
from time import perf_counter
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4


def request_bytes(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    body: bytes | None = None,
    content_type: str | None = None,
    token: str,
    accept: str = "application/json",
) -> tuple[int, dict[str, str], bytes]:
    headers = {
        "accept": accept,
        "x-internal-service-token": token,
    }
    if content_type:
        headers["content-type"] = content_type
    request = Request(
        f"{base_url.rstrip('/')}{path}",
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with urlopen(request, timeout=240) as response:
            return response.status, dict(response.headers.items()), response.read()
    except HTTPError as error:
        return error.code, dict(error.headers.items()), error.read()
    except URLError as error:
        raise RuntimeError(f"request failed for {path}: {error.reason}") from error


def json_body(raw: bytes, path: str) -> dict[str, object]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"{path} did not return JSON") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{path} did not return an object")
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def probe_mp3(path: Path) -> dict[str, object]:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,sample_rate,channels,bit_rate",
            "-show_entries",
            "format=duration,bit_rate",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(completed.stdout)
    stream = payload["streams"][0]
    fmt = payload["format"]
    return {
        "codec": stream["codec_name"],
        "sample_rate": int(stream["sample_rate"]),
        "channels": int(stream["channels"]),
        "bit_rate": int(stream["bit_rate"]),
        "duration": float(fmt["duration"]),
        "format_bit_rate": int(fmt["bit_rate"]),
    }


def main() -> int:
    parser = ArgumentParser(description="Verify candidate STT, Piper, and FFmpeg output.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8002")
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--wav", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    token = args.token_file.read_text(encoding="utf-8").strip()
    require(bool(token), "service token is empty")
    wav = args.wav.read_bytes()
    require(wav.startswith(b"RIFF") and b"WAVE" in wav[:16], "input is not a WAV file")

    started = perf_counter()
    live_status, _, live_raw = request_bytes(args.base_url, "/livez", token=token)
    live = json_body(live_raw, "/livez")
    require(live_status == 200 and live.get("status") == "ok", "candidate liveness failed")

    health_status, _, health_raw = request_bytes(args.base_url, "/health", token=token)
    health = json_body(health_raw, "/health")
    require(health_status == 200 and health == {"status": "ok"}, "candidate process health failed")

    ready_status, _, ready_raw = request_bytes(args.base_url, "/readyz", token=token)
    ready = json_body(ready_raw, "/readyz")
    require(
        ready_status == 200
        and ready.get("status") == "ok"
        and ready.get("stt_loaded") is True
        and ready.get("piper_loaded") is True
        and ready.get("ffmpeg_available") is True,
        "candidate readiness failed",
    )

    stt_started = perf_counter()
    stt_status, _, stt_raw = request_bytes(
        args.base_url,
        "/stt/transcribe",
        method="POST",
        body=wav,
        content_type="audio/wav",
        token=token,
    )
    stt = json_body(stt_raw, "/stt/transcribe")
    require(stt_status == 200 and stt.get("speech_detected") is True, "candidate STT failed")
    transcript = stt.get("text")
    require(isinstance(transcript, str) and transcript.strip(), "candidate STT returned no speech")

    request_id = str(uuid4())
    tts_started = perf_counter()
    tts_status, tts_headers, tts_raw = request_bytes(
        args.base_url,
        "/tts/synthesize",
        method="POST",
        body=json.dumps({"request_id": request_id, "text": "BMO is ready."}).encode("utf-8"),
        content_type="application/json",
        accept="audio/mpeg",
        token=token,
    )
    require(tts_status == 200 and tts_raw, "candidate Piper synthesis failed")
    require(tts_headers.get("x-tts-engine") == "piper", "candidate TTS engine metadata is invalid")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(tts_raw)
    metadata = probe_mp3(args.output)
    require(
        metadata["codec"] == "mp3"
        and metadata["sample_rate"] == 24_000
        and metadata["channels"] == 1
        and 80_000 <= metadata["bit_rate"] <= 112_000,
        "candidate MP3 contract is invalid",
    )

    report = {
        "pass": True,
        "base_url": args.base_url,
        "ready": ready,
        "stt": {
            "status": stt_status,
            "text": transcript,
            "speech_detected": stt["speech_detected"],
            "seconds": round(perf_counter() - stt_started, 3),
        },
        "tts": {
            "status": tts_status,
            "engine": tts_headers.get("x-tts-engine"),
            "bytes": len(tts_raw),
            "seconds": round(perf_counter() - tts_started, 3),
        },
        "mp3": metadata,
        "total_seconds": round(perf_counter() - started, 3),
        "output": str(args.output),
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.CalledProcessError, KeyError, TypeError, ValueError) as error:
        print(json.dumps({"pass": False, "error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from error

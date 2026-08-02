from __future__ import annotations

from pathlib import Path
from threading import Event, Thread
import argparse
import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid

from .audio import validate_mp3, validate_wav
from .host_monitor import Sample, _http_status, _inspect, _kernel_oom, _mem_available, evaluate_sample
from .text_set import load_phrases


def read_environment_value(path: Path, key: str) -> str:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.strip() == key:
            value = value.strip().strip('"').strip("'")
            if value:
                return value
    raise RuntimeError(f"{key} is missing")


def _audio_cgroup_paths() -> tuple[Path, Path]:
    inspect = _inspect("bmo-production-audio-1")
    if inspect is None or not inspect["State"].get("Running"):
        raise RuntimeError("production Audio is not running")
    root = Path(
        f"/sys/fs/cgroup/system.slice/docker-{inspect['Id']}.scope"
    )
    return root / "memory.current", root / "cpu.stat"


def _cpu_usage(path: Path) -> int:
    for line in path.read_text(encoding="ascii").splitlines():
        if line.startswith("usage_usec "):
            return int(line.split()[1])
    raise RuntimeError("Audio CPU usage unavailable")


def _port_busy() -> bool:
    result = subprocess.run(
        [
            "ss",
            "-Htn",
            "state",
            "established",
            "( sport = :8001 or dport = :8001 )",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        timeout=5,
        check=False,
    )
    return bool(result.stdout.strip())


def _wait_idle(timeout_seconds: float = 30) -> None:
    deadline = time.monotonic() + timeout_seconds
    while _port_busy():
        if time.monotonic() >= deadline:
            raise RuntimeError("production Audio remained busy")
        time.sleep(0.5)


def _production_guard(baseline_kernel_oom: int) -> None:
    backend = _inspect("bmo-production-backend-1")
    audio = _inspect("bmo-production-audio-1")
    if backend is None or audio is None:
        raise RuntimeError("production container missing")
    sample = Sample(
        host_mem_available=_mem_available(),
        free_disk=shutil.disk_usage("/opt/bmo/temp").free,
        kernel_oom=_kernel_oom(Path("/sys/fs/cgroup/system.slice/memory.events")),
        baseline_kernel_oom=baseline_kernel_oom,
        backend_healthy=backend["State"].get("Health", {}).get("Status") == "healthy"
        and _http_status("https://api.personalbmo.web.id/health") == 200
        and _http_status("https://api.personalbmo.web.id/livez") == 404
        and _http_status("https://api.personalbmo.web.id/readyz") == 404,
        audio_healthy=audio["State"].get("Health", {}).get("Status") == "healthy",
        hermes_healthy=_http_status("http://127.0.0.1:8642/health") == 200,
        backend_restarts=int(backend.get("RestartCount", 0)),
        audio_restarts=int(audio.get("RestartCount", 0)),
        candidate_oom=bool(audio["State"].get("OOMKilled")),
        candidate_restarts=0,
    )
    if evaluate_sample(sample) != "ok":
        raise RuntimeError("production safety gate is not green")


def _decode_mp3(input_path: Path, output_path: Path) -> None:
    result = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-i",
            str(input_path),
            "-ac",
            "1",
            "-ar",
            "24000",
            "-c:a",
            "pcm_s16le",
            str(output_path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        output_path.unlink(missing_ok=True)
        raise RuntimeError("Kokoro reference decode failed")


def _request(
    *,
    token: str,
    text: str,
    memory_path: Path,
    cpu_path: Path,
) -> tuple[bytes, dict[str, object]]:
    request_id = str(uuid.uuid4())
    body = json.dumps(
        {"request_id": request_id, "text": text, "use_rvc": False},
        separators=(",", ":"),
    ).encode("utf-8")
    request = urllib.request.Request(
        "http://127.0.0.1:8001/tts/synthesize",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
            "X-Internal-Service-Token": token,
        },
    )
    stop = Event()
    memory_values: list[int] = []

    def sample() -> None:
        while not stop.is_set():
            memory_values.append(int(memory_path.read_text(encoding="ascii")))
            stop.wait(0.02)

    memory_before = int(memory_path.read_text(encoding="ascii"))
    cpu_before = _cpu_usage(cpu_path)
    sampler = Thread(target=sample, daemon=True)
    sampler.start()
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            audio = response.read()
            status = int(response.status)
            engine = response.headers.get("X-TTS-Engine")
            rvc_applied = response.headers.get("X-RVC-Applied")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Kokoro reference request failed with HTTP {error.code}") from error
    finally:
        elapsed = time.perf_counter() - started
        stop.set()
        sampler.join(timeout=1)
    memory_after = int(memory_path.read_text(encoding="ascii"))
    cpu_after = _cpu_usage(cpu_path)
    if status != 200 or engine != "kokoro" or rvc_applied != "false" or not audio:
        raise RuntimeError("production response was not Kokoro-only audio")
    return audio, {
        "request_id": request_id,
        "request_latency_seconds": elapsed,
        "tts_engine": engine,
        "rvc_applied": False,
        "audio_memory_before": memory_before,
        "audio_memory_peak": max(memory_values or [memory_before, memory_after]),
        "audio_memory_after": memory_after,
        "audio_cpu_seconds": max(0, cpu_after - cpu_before) / 1_000_000,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--text-set", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--baseline-kernel-oom", type=int, required=True)
    args = parser.parse_args()
    token = read_environment_value(args.environment, "INTERNAL_SERVICE_TOKEN")
    output_root = args.output_root.resolve(strict=True)
    mp3_root = output_root / "mp3"
    wav_root = output_root / "decoded-wav"
    mp3_root.mkdir(parents=True, exist_ok=True)
    wav_root.mkdir(parents=True, exist_ok=True)
    memory_path, cpu_path = _audio_cgroup_paths()
    records: list[dict[str, object]] = []
    for phrase in load_phrases(args.text_set):
        _production_guard(args.baseline_kernel_oom)
        _wait_idle()
        mp3_path = mp3_root / f"kokoro-{phrase['id']}.mp3"
        wav_path = wav_root / f"kokoro-{phrase['id']}-decoded.wav"
        mp3_path.unlink(missing_ok=True)
        wav_path.unlink(missing_ok=True)
        audio, request_metrics = _request(
            token=token,
            text=phrase["text"],
            memory_path=memory_path,
            cpu_path=cpu_path,
        )
        mp3_path.write_bytes(audio)
        mp3_metrics = validate_mp3(mp3_path)
        _decode_mp3(mp3_path, wav_path)
        wav_metrics = validate_wav(wav_path, expected_sample_rate=24000)
        records.append(
            {
                "phrase_id": phrase["id"],
                "phrase_class": phrase["class"],
                "text": phrase["text"],
                **request_metrics,
                "final_mp3": {"path": str(mp3_path), **mp3_metrics},
                "decoded_reference_wav": {"path": str(wav_path), **wav_metrics},
                "source_wav_available": False,
                "source_wav_note": "Production endpoint returns final MP3 only; WAV is a lossless decode of that MP3, not pre-FFmpeg source audio.",
            }
        )
        _production_guard(args.baseline_kernel_oom)
    args.results.parent.mkdir(parents=True, exist_ok=True)
    args.results.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "baseline": "approved production Kokoro warm endpoint",
                "cold_start_measured": False,
                "records": records,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

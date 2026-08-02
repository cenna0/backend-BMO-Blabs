from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from statistics import median
from typing import Iterable
import argparse
import json
import math
import os
import resource
import shutil
import sys
import time

from .audio import validate_mp3, validate_wav
from .ffmpeg import convert_wav_to_mp3
from .manifest import validate_manifest
from .process import PersistentWorker
from .shutdown import ShutdownRequested, install_shutdown_handlers
from .telemetry import Sampler, descriptor_count, file_count, host_mem_available, memory_current, process_count
from .text_set import load_phrases


def ensure_safe_to_start(control_root: Path) -> None:
    if (control_root / "warning").exists() or (control_root / "abort").exists():
        raise RuntimeError("host monitor stopped new benchmark work")


def percentile(values: Iterable[float], percentile_value: int) -> float | None:
    ordered = sorted(float(value) for value in values)
    if len(ordered) < 20:
        return None
    index = math.ceil((percentile_value / 100) * (len(ordered) - 1))
    return ordered[index]


def summarize_records(records: Iterable[dict[str, object]]) -> dict[str, object]:
    grouped: dict[tuple[str, str], list[float]] = defaultdict(list)
    for record in records:
        grouped[(str(record["mode"]), str(record["phrase_class"]))].append(
            float(record["total_seconds"])
        )
    result: dict[str, dict[str, object]] = {}
    for (mode, phrase_class), values in grouped.items():
        result.setdefault(mode, {})[phrase_class] = {
            "count": len(values),
            "median_seconds": median(values),
            "maximum_seconds": max(values),
            "p95_seconds": percentile(values, 95),
        }
    return result


def _child_cpu() -> float:
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    return usage.ru_utime + usage.ru_stime


def _worker_command(manifest: Path, output_root: Path) -> list[str]:
    return [
        sys.executable,
        "-m",
        "bmo_piper.worker",
        "--manifest",
        str(manifest),
        "--output-root",
        str(output_root),
    ]


def _run_request(
    worker: PersistentWorker,
    phrase: dict[str, str],
    *,
    output_root: Path,
    temp_root: Path,
    relative_prefix: str,
    mode: str,
    iteration: int,
    retain: bool,
) -> dict[str, object]:
    request_id = f"{mode}-{phrase['id']}-{iteration:02d}"
    raw_relative = Path(relative_prefix) / "raw" / f"{request_id}.wav"
    validated_relative = Path(relative_prefix) / "validated" / f"{request_id}.wav"
    mp3_relative = Path(relative_prefix) / "mp3" / f"{request_id}.mp3"
    for relative in (raw_relative, validated_relative, mp3_relative):
        (output_root / relative).parent.mkdir(parents=True, exist_ok=True)
    raw_path = output_root / raw_relative
    validated_path = output_root / validated_relative
    mp3_path = output_root / mp3_relative
    started = time.perf_counter()
    with Sampler(temp_root) as sampler:
        response = worker.request(
            {
                "operation": "synthesize",
                "request_id": request_id,
                "text": phrase["text"],
                "output_path": str(raw_relative),
                "speaker_name": "prudence",
                "speaker_id": 0,
            }
        )
        text_to_wav_seconds = time.perf_counter() - started
        raw_metrics = validate_wav(raw_path, expected_sample_rate=22050)
        shutil.copyfile(raw_path, validated_path)
        validated_metrics = validate_wav(validated_path, expected_sample_rate=22050)
        child_cpu_before = _child_cpu()
        ffmpeg_seconds = convert_wav_to_mp3(validated_path, mp3_path)
        ffmpeg_cpu = max(0.0, _child_cpu() - child_cpu_before)
        text_to_mp3_seconds = time.perf_counter() - started
        mp3_metrics = validate_mp3(mp3_path)
    validation_complete_seconds = time.perf_counter() - started
    telemetry = sampler.result()
    duration = float(mp3_metrics["duration_seconds"])
    record: dict[str, object] = {
        "request_id": request_id,
        "phrase_id": phrase["id"],
        "phrase_class": phrase["class"],
        "mode": mode,
        "iteration": iteration,
        "success": True,
        "synthesis_seconds": response["synthesis_seconds"],
        "text_to_wav_seconds": text_to_wav_seconds,
        "ffmpeg_seconds": ffmpeg_seconds,
        "text_to_mp3_seconds": text_to_mp3_seconds,
        "validation_complete_seconds": validation_complete_seconds,
        "total_seconds": text_to_mp3_seconds,
        "worker_cpu_seconds": response["cpu_seconds"],
        "ffmpeg_cpu_seconds": ffmpeg_cpu,
        "cpu_seconds": float(response["cpu_seconds"]) + ffmpeg_cpu,
        "real_time_factor_synthesis": float(response["synthesis_seconds"]) / duration,
        "real_time_factor_total": text_to_mp3_seconds / duration,
        "model_load_count": response["model_load_count"],
        "speaker_name": response["speaker_name"],
        "speaker_id": response["speaker_id"],
        "raw_wav": {"path": str(raw_path), **raw_metrics},
        "validated_wav": {"path": str(validated_path), **validated_metrics},
        "final_mp3": {"path": str(mp3_path), **mp3_metrics},
        **telemetry.__dict__,
    }
    if not retain:
        raw_path.unlink(missing_ok=True)
        validated_path.unlink(missing_ok=True)
        mp3_path.unlink(missing_ok=True)
    return record


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--text-set", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--results", type=Path, required=True)
    args = parser.parse_args()
    install_shutdown_handlers()
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    output_root = args.output_root.resolve(strict=True)
    temp_root = Path("/tmp/piper-work")
    temp_root.mkdir(parents=True, exist_ok=True)
    control_root = output_root / "control"
    control_root.mkdir(exist_ok=True)
    identity = validate_manifest(args.manifest)
    phrases = load_phrases(args.text_set)
    by_id = {phrase["id"]: phrase for phrase in phrases}
    records: list[dict[str, object]] = []
    cold_loads: list[dict[str, object]] = []

    for phrase_id in ("short_greeting", "calm_medium", "long_normal"):
        ensure_safe_to_start(control_root)
        process_started = time.perf_counter()
        worker = PersistentWorker(
            _worker_command(args.manifest, output_root), cleanup_root=output_root
        )
        process_ready = time.perf_counter() - process_started
        try:
            record = _run_request(
                worker,
                by_id[phrase_id],
                output_root=output_root,
                temp_root=temp_root,
                relative_prefix="benchmark-temp/cold",
                mode="cold",
                iteration=1,
                retain=False,
            )
            record["process_start_and_model_load_seconds"] = process_ready
            record["model_load_seconds"] = worker.ready["load_seconds"]
            record["cold_total_text_to_mp3_seconds"] = process_ready + float(record["text_to_mp3_seconds"])
            record["cold_validation_complete_seconds"] = process_ready + float(record["validation_complete_seconds"])
            records.append(record)
            cold_loads.append(dict(worker.ready))
        finally:
            worker.close()

    warm_process_started = time.perf_counter()
    worker = PersistentWorker(
        _worker_command(args.manifest, output_root), cleanup_root=output_root
    )
    warm_ready_seconds = time.perf_counter() - warm_process_started
    warm_idle_memory = memory_current()
    try:
        for phrase in phrases:
            ensure_safe_to_start(control_root)
            records.append(
                _run_request(
                    worker,
                    phrase,
                    output_root=output_root,
                    temp_root=temp_root,
                    relative_prefix="canonical",
                    mode="canonical",
                    iteration=1,
                    retain=True,
                )
            )
        for phrase_id in ("short_greeting", "calm_medium", "long_normal"):
            for iteration in range(1, 6):
                ensure_safe_to_start(control_root)
                records.append(
                    _run_request(
                        worker,
                        by_id[phrase_id],
                        output_root=output_root,
                        temp_root=temp_root,
                        relative_prefix="benchmark-temp/warm",
                        mode="warm",
                        iteration=iteration,
                        retain=False,
                    )
                )
        for iteration in range(1, 3):
            ensure_safe_to_start(control_root)
            records.append(
                _run_request(
                    worker,
                    by_id["continuous"],
                    output_root=output_root,
                    temp_root=temp_root,
                    relative_prefix="benchmark-temp/continuous",
                    mode="continuous",
                    iteration=iteration,
                    retain=False,
                )
            )
        stability: list[dict[str, object]] = []
        rotation = ("short_greeting", "calm_medium", "long_normal")
        for index in range(20):
            ensure_safe_to_start(control_root)
            record = _run_request(
                worker,
                by_id[rotation[index % len(rotation)]],
                output_root=output_root,
                temp_root=temp_root,
                relative_prefix="benchmark-temp/stability",
                mode="stability",
                iteration=index + 1,
                retain=False,
            )
            records.append(record)
            stability.append(record)
        retained_memory = memory_current()
        final_process_count = process_count()
        final_descriptors = descriptor_count()
        final_temp_files = file_count(temp_root)
        results = {
            "schema_version": 1,
            "started_at": started_at,
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "identity": {
                "engine_revision": identity.engine_revision,
                "voice_revision": identity.voice_revision,
                "model_sha256": identity.model_sha256,
                "config_sha256": identity.config_sha256,
                "speaker_name": identity.speaker_name,
                "speaker_id": identity.speaker_id,
                "sample_rate": identity.sample_rate,
            },
            "thread_environment": {name: os.environ.get(name) for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS")},
            "cold_ready": cold_loads,
            "warm_ready_seconds": warm_ready_seconds,
            "warm_worker_ready": worker.ready,
            "warm_idle_memory": warm_idle_memory,
            "retained_memory": retained_memory,
            "minimum_host_mem_available": min(int(record["host_mem_available_min"]) for record in records),
            "peak_candidate_memory": max(int(record["memory_peak"]) for record in records),
            "records": records,
            "summary": summarize_records(records),
            "stability": {
                "attempted": 20,
                "successes": len(stability),
                "failures": 20 - len(stability),
                "model_load_counts": sorted(set(int(record["model_load_count"]) for record in stability)),
                "memory_after_first": stability[0]["memory_after"],
                "memory_after_last": stability[-1]["memory_after"],
                "process_after_first": stability[0]["process_after"],
                "process_after_last": stability[-1]["process_after"],
                "descriptors_after_first": stability[0]["descriptors_after"],
                "descriptors_after_last": stability[-1]["descriptors_after"],
                "temp_files_after_first": stability[0]["temp_files_after"],
                "temp_files_after_last": stability[-1]["temp_files_after"],
            },
            "final": {
                "process_count": final_process_count,
                "descriptor_count": final_descriptors,
                "temp_file_count": final_temp_files,
                "host_mem_available": host_mem_available(),
            },
        }
        args.results.parent.mkdir(parents=True, exist_ok=True)
        args.results.write_text(json.dumps(results, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    finally:
        worker.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ShutdownRequested:
        raise SystemExit(0) from None

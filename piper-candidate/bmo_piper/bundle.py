from __future__ import annotations

from pathlib import Path
from typing import Any
import argparse
import hashlib
import json
import secrets
import shutil
import tarfile

from .audio import probe_audio, validate_mp3, validate_wav
from .manifest import sha256_file
from .text_set import load_phrases


LEGACY = (
    {
        "id": "prompt1-foundation-baseline",
        "wav": Path("/opt/bmo/temp/p8-rvc-foundation-candidate/evidence/listening/p8-foundation-rvc-final.wav"),
        "mp3": Path("/opt/bmo/temp/p8-rvc-foundation-candidate/evidence/listening/p8-foundation-rvc-final.mp3"),
        "wav_sha256": "be0614b4106f32cf65d324378ca81d19092010e4ca8237bd02e09e7d3561dc41",
        "mp3_sha256": "a7b0b3d13ebd8dbd3cdee0e2da12a2f6b8300e31160a9db651680ce411fac206",
        "parameters": {"f0_method": "rmvpe", "index_rate": 0.75},
    },
    {
        "id": "prompt2-pilot-baseline",
        "wav": Path("/opt/bmo/temp/p8-rvc-benchmark/listening/pilot-baseline/01-ready.wav"),
        "mp3": Path("/opt/bmo/temp/p8-rvc-benchmark/listening/pilot-baseline/01-ready.mp3"),
        "wav_sha256": "7d305d17469832cb53b2da971901777b3dacf79f223bcb0173b3c4c90debbdf6",
        "mp3_sha256": "5efb29fc626a12e636621675c8a8b7a4baf3672c558d8d0c88dd9e65fe745244",
        "parameters": {"f0_method": "rmvpe", "index_rate": 0.75},
    },
    {
        "id": "prompt2-pilot-no-retrieval",
        "wav": Path("/opt/bmo/temp/p8-rvc-benchmark/listening/pilot-index-none/01-ready.wav"),
        "mp3": Path("/opt/bmo/temp/p8-rvc-benchmark/listening/pilot-index-none/01-ready.mp3"),
        "wav_sha256": "c0ebbf69e2d79fd114af1c2812ba35962c2d97d16495d84ea7105d73222f2252",
        "mp3_sha256": "356fcda426a4021e2ed7bbb7bcea26baed9023049f79c19bdc884702af0836ef",
        "parameters": {"f0_method": "rmvpe", "index_rate": 0.0},
    },
)


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def _sanitize_paths(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: (Path(item).name if key == "path" and isinstance(item, str) else _sanitize_paths(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_sanitize_paths(item) for item in value]
    return value


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _checksums(root: Path, destination: Path) -> None:
    files = sorted(
        path for path in root.rglob("*") if path.is_file() and path != destination
    )
    destination.write_text(
        "".join(f"{sha256_file(path)}  {path.relative_to(root)}\n" for path in files),
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--piper-results", type=Path, required=True)
    parser.add_argument("--piper-output-root", type=Path, required=True)
    parser.add_argument("--kokoro-results", type=Path, required=True)
    parser.add_argument("--text-set", type=Path, required=True)
    parser.add_argument("--asset-manifest", type=Path, required=True)
    parser.add_argument("--listening-root", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    args = parser.parse_args()
    root = args.listening_root.resolve()
    if root.exists():
        raise RuntimeError("listening root already exists")
    root.mkdir(parents=True)
    for directory in (
        "00-source-text",
        "01-kokoro-reference/decoded-wav",
        "01-kokoro-reference/mp3",
        "02-piper-prudence/raw-wav",
        "02-piper-prudence/validated-wav",
        "02-piper-prudence/mp3",
        "03-blind-comparison",
        "04-legacy-rvc-short-reference",
        "30-second-comparison",
        "metrics",
        "manifests",
    ):
        (root / directory).mkdir(parents=True, exist_ok=True)

    phrase_list = load_phrases(args.text_set)
    phrases = {item["id"]: item for item in phrase_list}
    _copy(args.text_set, root / "00-source-text/comparison-text.json")
    (root / "00-source-text/continuous.txt").write_text(
        phrases["continuous"]["text"] + "\n", encoding="utf-8"
    )
    piper = _load(args.piper_results)
    kokoro = _load(args.kokoro_results)
    piper_records = {
        record["phrase_id"]: record
        for record in piper["records"]
        if record["mode"] == "canonical"
    }
    kokoro_records = {record["phrase_id"]: record for record in kokoro["records"]}
    if set(piper_records) != set(phrases) or set(kokoro_records) != set(phrases):
        raise RuntimeError("comparison outputs are incomplete")

    blind_key: dict[str, dict[str, str]] = {}
    audio_entries: list[dict[str, Any]] = []
    comparisons: list[dict[str, Any]] = []
    piper_output_root = args.piper_output_root.resolve(strict=True)

    def piper_host_path(container_path: str) -> Path:
        path = Path(container_path)
        if not path.is_absolute() or path.parts[:2] != ("/", "output"):
            raise RuntimeError("unexpected Piper container output path")
        resolved = (piper_output_root / Path(*path.parts[2:])).resolve(strict=True)
        if piper_output_root not in resolved.parents:
            raise RuntimeError("Piper output path escaped host root")
        return resolved

    for phrase_id, phrase in phrases.items():
        piper_record = piper_records[phrase_id]
        kokoro_record = kokoro_records[phrase_id]
        piper_raw = piper_host_path(piper_record["raw_wav"]["path"])
        piper_validated = piper_host_path(piper_record["validated_wav"]["path"])
        piper_mp3 = piper_host_path(piper_record["final_mp3"]["path"])
        kokoro_wav = Path(kokoro_record["decoded_reference_wav"]["path"])
        kokoro_mp3 = Path(kokoro_record["final_mp3"]["path"])
        validate_wav(piper_raw, expected_sample_rate=22050)
        validate_wav(piper_validated, expected_sample_rate=22050)
        validate_mp3(piper_mp3)
        validate_wav(kokoro_wav, expected_sample_rate=24000)
        validate_mp3(kokoro_mp3)
        targets = {
            "piper_raw_wav": root / f"02-piper-prudence/raw-wav/piper-prudence-{phrase_id}.wav",
            "piper_validated_wav": root / f"02-piper-prudence/validated-wav/piper-prudence-{phrase_id}.wav",
            "piper_mp3": root / f"02-piper-prudence/mp3/piper-prudence-{phrase_id}.mp3",
            "kokoro_wav": root / f"01-kokoro-reference/decoded-wav/kokoro-{phrase_id}-decoded.wav",
            "kokoro_mp3": root / f"01-kokoro-reference/mp3/kokoro-{phrase_id}.mp3",
        }
        for source, target in (
            (piper_raw, targets["piper_raw_wav"]),
            (piper_validated, targets["piper_validated_wav"]),
            (piper_mp3, targets["piper_mp3"]),
            (kokoro_wav, targets["kokoro_wav"]),
            (kokoro_mp3, targets["kokoro_mp3"]),
        ):
            _copy(source, target)
            audio_entries.append(
                {
                    "path": str(target.relative_to(root)),
                    "bytes": target.stat().st_size,
                    "sha256": sha256_file(target),
                    "phrase_id": phrase_id,
                }
            )
        engines = ["kokoro", "piper-prudence"]
        secrets.SystemRandom().shuffle(engines)
        blind_key[phrase_id] = {"A": engines[0], "B": engines[1]}
        source_by_engine = {"kokoro": kokoro_mp3, "piper-prudence": piper_mp3}
        for alias in ("A", "B"):
            _copy(
                source_by_engine[blind_key[phrase_id][alias]],
                root / f"03-blind-comparison/{phrase_id}-{alias}.mp3",
            )
        comparisons.append(
            {
                "phrase_id": phrase_id,
                "class": phrase["class"],
                "text": phrase["text"],
                "kokoro_warm": {
                    "request_latency_seconds": kokoro_record["request_latency_seconds"],
                    "duration_seconds": kokoro_record["final_mp3"]["duration_seconds"],
                    "audio_memory_peak": kokoro_record["audio_memory_peak"],
                    "audio_cpu_seconds": kokoro_record["audio_cpu_seconds"],
                },
                "piper_persistent": {
                    "synthesis_seconds": piper_record["synthesis_seconds"],
                    "text_to_wav_seconds": piper_record["text_to_wav_seconds"],
                    "ffmpeg_seconds": piper_record["ffmpeg_seconds"],
                    "text_to_mp3_seconds": piper_record["text_to_mp3_seconds"],
                    "validation_complete_seconds": piper_record["validation_complete_seconds"],
                    "duration_seconds": piper_record["final_mp3"]["duration_seconds"],
                    "memory_peak": piper_record["memory_peak"],
                    "cpu_seconds": piper_record["cpu_seconds"],
                },
            }
        )

    legacy_records: list[dict[str, Any]] = []
    for item in LEGACY:
        if sha256_file(item["wav"]) != item["wav_sha256"] or sha256_file(item["mp3"]) != item["mp3_sha256"]:
            raise RuntimeError(f"legacy RVC hash mismatch: {item['id']}")
        wav_metrics = validate_wav(item["wav"], expected_sample_rate=40000)
        mp3_metrics = validate_mp3(item["mp3"])
        wav_target = root / f"04-legacy-rvc-short-reference/{item['id']}.wav"
        mp3_target = root / f"04-legacy-rvc-short-reference/{item['id']}.mp3"
        _copy(item["wav"], wav_target)
        _copy(item["mp3"], mp3_target)
        legacy_records.append(
            {
                "id": item["id"],
                "source_text": "Hi! BMO is ready to help.",
                "parameters": item["parameters"],
                "wav": {"path": str(wav_target.relative_to(root)), **wav_metrics},
                "mp3": {"path": str(mp3_target.relative_to(root)), **mp3_metrics},
                "limitation": "Legacy short RVC diagnostic only; not a same-duration or long-form competitor to the new continuous comparison.",
            }
        )
    _write_json(root / "04-legacy-rvc-short-reference/legacy-manifest.json", legacy_records)

    continuous = comparisons[[item["phrase_id"] for item in comparisons].index("continuous")]
    continuous_root = root / "30-second-comparison"
    continuous_files = {
        "kokoro-labeled.wav": root / "01-kokoro-reference/decoded-wav/kokoro-continuous-decoded.wav",
        "kokoro-labeled.mp3": root / "01-kokoro-reference/mp3/kokoro-continuous.mp3",
        "piper-prudence-labeled.wav": root / "02-piper-prudence/validated-wav/piper-prudence-continuous.wav",
        "piper-prudence-labeled.mp3": root / "02-piper-prudence/mp3/piper-prudence-continuous.mp3",
    }
    for name, source in continuous_files.items():
        _copy(source, continuous_root / name)
    for alias in ("A", "B"):
        engine = blind_key["continuous"][alias]
        source = continuous_files[
            "kokoro-labeled.mp3" if engine == "kokoro" else "piper-prudence-labeled.mp3"
        ]
        _copy(source, continuous_root / f"blind-{alias}.mp3")
    (continuous_root / "source-text.txt").write_text(
        phrases["continuous"]["text"] + "\n", encoding="utf-8"
    )
    _write_json(continuous_root / "metrics.json", continuous)
    (continuous_root / "LISTENING-INSTRUCTIONS.md").write_text(
        "# Continuous comparison\n\nListen to `blind-A.mp3` and `blind-B.mp3` at least twice before opening `BLIND-KEY.md`. Use fixed volume and record your first impressions. Both files use the identical source text. The Kokoro WAV is decoded from the production endpoint's MP3 because that endpoint does not expose its pre-FFmpeg WAV.\n",
        encoding="utf-8",
    )
    (continuous_root / "BLIND-KEY.md").write_text(
        f"# Continuous blind key\n\n- A: {blind_key['continuous']['A']}\n- B: {blind_key['continuous']['B']}\n",
        encoding="utf-8",
    )
    _checksums(continuous_root, continuous_root / "SHA256SUMS")

    asset_manifest = _load(args.asset_manifest)
    _write_json(root / "manifests/piper-asset-identity.json", asset_manifest)
    _write_json(root / "metrics/same-text-comparison.json", comparisons)
    _write_json(root / "metrics/legacy-rvc-validation.json", legacy_records)
    combined_results = {
        "schema_version": 1,
        "piper": _sanitize_paths(piper),
        "kokoro": _sanitize_paths(kokoro),
        "same_text_comparison": comparisons,
        "limitations": [
            "Kokoro is a warm production endpoint baseline; no Kokoro cold start was measured.",
            "Piper cold and persistent warm measurements are separated.",
            "This is feasibility evidence, not a replacement canary.",
            "Automated metrics do not determine subjective BMO similarity.",
            "Legacy RVC files are short diagnostics only.",
        ],
    }
    _write_json(root / "benchmark-results.json", combined_results)

    key_lines = ["# Blind key", "", "Open only after completing blind listening.", ""]
    for phrase_id in phrases:
        key_lines.append(
            f"- `{phrase_id}` — A: {blind_key[phrase_id]['A']}; B: {blind_key[phrase_id]['B']}"
        )
    (root / "BLIND-KEY.md").write_text("\n".join(key_lines) + "\n", encoding="utf-8")
    guide = """# P8 Piper Prudence listening guide

## Start blind

Use the files in `03-blind-comparison/` first. Do not open `BLIND-KEY.md` until you have recorded first impressions. Use the same headphones or speakers, keep playback volume fixed, and listen to both 30-second files at least twice.

For each A/B pair, record similarity to the intended BMO character, friendliness, playfulness, intelligibility, naturalness, pitch, consonant clarity, vowel clarity, robotic or metallic artifacts, calm-speech stability, excited-speech stability, names and numbers, punctuation handling, unnatural pauses, clipping, long-form stability, and acceptability after at least 30 continuous seconds.

## Then inspect labeled files

After revealing the key, use `01-kokoro-reference/`, `02-piper-prudence/`, and `30-second-comparison/` to confirm your notes. The production Kokoro WAVs are decoded copies of final MP3 output; source WAV was not exposed. Technical metrics are guardrails only and do not select a winner.

## Legacy RVC limitation

`04-legacy-rvc-short-reference/` contains validated 2.8-second Prompt 1/2 diagnostics for the greeting only. They are not same-duration competitors to the continuous files, are not Prompt 3 samples, and provide no warm or 20-request stability evidence.

Only the operator may approve subjective voice quality. This bundle does not mark Piper deployed and does not mark P8 verified.
"""
    (root / "LISTENING-GUIDE.md").write_text(guide, encoding="utf-8")
    all_audio_files = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in {".wav", ".mp3"}:
            all_audio_files.append(
                {
                    "path": str(path.relative_to(root)),
                    "bytes": path.stat().st_size,
                    "sha256": sha256_file(path),
                    "probe": probe_audio(path),
                }
            )
    manifest = {
        "schema_version": 1,
        "purpose": "private P8 Piper Prudence feasibility listening bundle",
        "source_text": list(phrases.values()),
        "piper_identity": {
            "engine": asset_manifest["engine"],
            "voice": asset_manifest["voice"],
            "artifacts": asset_manifest["artifacts"],
        },
        "kokoro_baseline": "approved production Kokoro, warm endpoint, RVC disabled",
        "primary_audio_files": audio_entries,
        "all_audio_files": all_audio_files,
        "subjective_approval": False,
    }
    _write_json(root / "manifest.json", manifest)
    _checksums(root, root / "SHA256SUMS")

    forbidden_suffixes = {".onnx", ".pth", ".index", ".env", ".log", ".py", ".pyc"}
    forbidden = [path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in forbidden_suffixes]
    if forbidden:
        raise RuntimeError(f"forbidden archive content: {forbidden}")
    args.archive.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(args.archive, "w:gz") as archive:
        archive.add(root, arcname="p8-piper-listening-bundle")
    print(
        json.dumps(
            {
                "listening_root": str(root),
                "archive": str(args.archive.resolve()),
                "archive_bytes": args.archive.stat().st_size,
                "archive_sha256": sha256_file(args.archive),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

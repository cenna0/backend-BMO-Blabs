#!/usr/bin/env python3
from __future__ import annotations

from argparse import ArgumentParser
from pathlib import Path
from typing import Callable, Sequence
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.model_assets import (
    KOKORO_SPEC,
    WHISPER_SPEC,
    ModelSpec,
    build_model_manifest,
    materialize_runtime_snapshot,
    runtime_snapshot_path,
    upstream_snapshot_path,
)

DEFAULT_MODELS_DIR = Path("/opt/bmo/models")
MODEL_SPECS = {
    "whisper": WHISPER_SPEC,
    "kokoro": KOKORO_SPEC,
}
Downloader = Callable[..., str]


def provision_models(
    *,
    specs: Sequence[ModelSpec],
    models_dir: Path,
    manifest_path: Path,
    downloader: Downloader,
) -> dict[str, object]:
    snapshots: list[tuple[ModelSpec, Path]] = []
    for spec in specs:
        snapshot = Path(
            downloader(
                repo_id=spec.repository,
                revision=spec.revision,
                allow_patterns=list(spec.required_artifacts),
                cache_dir=str(models_dir / "hf-cache" / "hub"),
            ),
        )
        expected_upstream = upstream_snapshot_path(models_dir / "hf-cache", spec)
        if snapshot.resolve() != expected_upstream.resolve():
            raise RuntimeError(
                f"{spec.name} downloader returned unexpected snapshot path: {snapshot}",
            )
        runtime_snapshot = runtime_snapshot_path(models_dir / "runtime", spec)
        materialize_runtime_snapshot(
            upstream_snapshot=snapshot,
            runtime_snapshot=runtime_snapshot,
            spec=spec,
        )
        snapshots.append((spec, runtime_snapshot))
    return build_model_manifest(
        models_dir=models_dir,
        snapshots=snapshots,
        manifest_path=manifest_path,
    )


def _dry_run_manifest(specs: Sequence[ModelSpec], manifest_path: Path) -> None:
    manifest = {
        "status": "dry_run",
        "models": [
            {
                "name": spec.name,
                "repository": spec.repository,
                "revision": spec.revision,
                "required_artifacts": list(spec.required_artifacts),
                "license": spec.license,
                "license_source": spec.license_source,
            }
            for spec in specs
        ],
        "artifacts": [],
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main(argv: Sequence[str] | None = None, *, downloader: Downloader | None = None) -> int:
    parser = ArgumentParser(description="Provision exact P7 Whisper and Kokoro snapshots.")
    parser.add_argument("--model", choices=("whisper", "kokoro", "all"), default="all")
    parser.add_argument("--allow-download", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--models-dir", type=Path, default=DEFAULT_MODELS_DIR)
    parser.add_argument("--manifest", type=Path, default=Path("MODEL_MANIFEST.json"))
    args = parser.parse_args(argv)

    selected = (
        tuple(MODEL_SPECS.values())
        if args.model == "all"
        else (MODEL_SPECS[args.model],)
    )
    if args.dry_run:
        _dry_run_manifest(selected, args.manifest)
        print(json.dumps({"status": "dry_run", "manifest": str(args.manifest)}))
        return 0
    if not args.allow_download:
        print(
            "model download disabled; rerun with --allow-download after approval",
            file=sys.stderr,
        )
        return 2

    if downloader is None:
        from huggingface_hub import snapshot_download

        downloader = snapshot_download
    manifest = provision_models(
        specs=selected,
        models_dir=args.models_dir,
        manifest_path=args.manifest,
        downloader=downloader,
    )
    print(
        json.dumps(
            {
                "status": manifest["status"],
                "manifest": str(args.manifest),
                "artifact_count": len(manifest["artifacts"]),
            },
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

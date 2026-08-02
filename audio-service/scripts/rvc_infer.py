#!/usr/bin/env python3
from __future__ import annotations

from argparse import ArgumentParser, Namespace
from pathlib import Path
import logging
import os
import stat
import sys
from typing import Callable

import numpy as np


RVC_ENGINE_ROOT = Path("/opt/rvc-engine")


def _bounded_float(value: str, *, minimum: float, maximum: float) -> float:
    parsed = float(value)
    if not minimum <= parsed <= maximum:
        raise ValueError(f"value must be between {minimum} and {maximum}")
    return parsed


def build_parser() -> ArgumentParser:
    parser = ArgumentParser(description="Pinned CPU-only BMO RVC inference worker")
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--input-wav", type=Path, required=True)
    parser.add_argument("--output-wav", type=Path, required=True)
    parser.add_argument("--hubert-path", type=Path, required=True)
    parser.add_argument("--rmvpe-path", type=Path, required=True)
    parser.add_argument("--index-path", type=Path)
    parser.add_argument("--device", choices=("cpu",), default="cpu")
    parser.add_argument("--f0-up-key", type=int, choices=range(-24, 25), default=0)
    parser.add_argument("--f0-method", choices=("rmvpe",), default="rmvpe")
    parser.add_argument(
        "--index-rate",
        type=lambda value: _bounded_float(value, minimum=0.0, maximum=1.0),
        default=0.75,
    )
    parser.add_argument(
        "--protect",
        type=lambda value: _bounded_float(value, minimum=0.0, maximum=0.5),
        default=0.33,
    )
    parser.add_argument(
        "--rms-mix-rate",
        type=lambda value: _bounded_float(value, minimum=0.0, maximum=1.0),
        default=0.25,
    )
    return parser


def configure_checkpoint_safety(torch_module=None, dictionary_type=None) -> None:
    os.environ["TORCH_FORCE_WEIGHTS_ONLY_LOAD"] = "1"
    if torch_module is None:
        import torch as torch_module
    if dictionary_type is None:
        from fairseq.data.dictionary import Dictionary as dictionary_type
    torch_module.serialization.add_safe_globals([dictionary_type])


def _is_regular_file(path: Path | None) -> bool:
    if path is None:
        return False
    try:
        return stat.S_ISREG(path.lstat().st_mode)
    except OSError:
        return False


def _resolve_required(path: Path | None) -> Path:
    if not _is_regular_file(path):
        raise ValueError("required RVC asset is unavailable")
    try:
        return path.resolve(strict=True)
    except OSError as error:
        raise ValueError("required RVC asset is unavailable") from error


def _validated_paths(args: Namespace) -> dict[str, Path | None]:
    resolved = {
        "model": _resolve_required(args.model_path),
        "input": _resolve_required(args.input_wav),
        "hubert": _resolve_required(args.hubert_path),
        "rmvpe": _resolve_required(args.rmvpe_path),
        "index": _resolve_required(args.index_path) if args.index_path is not None else None,
    }
    if resolved["rmvpe"].name != "rmvpe.pt":
        raise ValueError("required RVC asset is unavailable")
    if args.output_wav.exists() or args.output_wav.is_symlink():
        raise ValueError("RVC output path is invalid")
    try:
        output_parent = args.output_wav.parent.resolve(strict=True)
    except OSError as error:
        raise ValueError("RVC output path is invalid") from error
    if output_parent != resolved["input"].parent or args.output_wav.suffix.lower() != ".wav":
        raise ValueError("RVC output path is invalid")
    resolved["output"] = output_parent / args.output_wav.name
    return resolved


def _load_vc_factory():
    configure_checkpoint_safety()
    if str(RVC_ENGINE_ROOT) not in sys.path:
        sys.path.insert(0, str(RVC_ENGINE_ROOT))
    from rvc.modules.vc.modules import VC
    return VC


def run_inference(
    args: Namespace,
    *,
    vc_factory: Callable | None = None,
    writer: Callable | None = None,
) -> None:
    paths = _validated_paths(args)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["weight_root"] = str(paths["model"].parent)
    os.environ["index_root"] = str(paths["index"].parent if paths["index"] else paths["input"].parent)
    os.environ["hubert_path"] = str(paths["hubert"])
    os.environ["rmvpe_root"] = str(paths["rmvpe"].parent)

    factory = vc_factory or _load_vc_factory()
    vc = factory()
    vc.get_vc(str(paths["model"]))
    sample_rate, audio, _timings, error = vc.vc_inference(
        0,
        str(paths["input"]),
        f0_up_key=args.f0_up_key,
        f0_method=args.f0_method,
        index_file=str(paths["index"]) if paths["index"] else None,
        index_rate=args.index_rate,
        filter_radius=3,
        resample_sr=0,
        rms_mix_rate=args.rms_mix_rate,
        protect=args.protect,
        hubert_path=str(paths["hubert"]),
    )
    samples = np.asarray(audio) if audio is not None else np.array([])
    if (
        error is not None
        or not isinstance(sample_rate, int)
        or not 8_000 <= sample_rate <= 96_000
        or samples.ndim != 1
        or samples.size == 0
        or not np.isfinite(samples).all()
    ):
        raise RuntimeError("RVC engine returned invalid output")

    if samples.dtype == np.int16:
        pcm16 = samples
    elif np.issubdtype(samples.dtype, np.floating) and np.abs(samples).max() <= 1:
        pcm16 = np.rint(samples * 32_767).astype(np.int16)
    else:
        raise RuntimeError("RVC engine returned invalid output")

    if writer is None:
        import soundfile as soundfile_module
        writer = soundfile_module.write
    writer(
        str(paths["output"]),
        pcm16,
        sample_rate,
        format="WAV",
        subtype="PCM_16",
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    previous_logging_disable = logging.root.manager.disable
    logging.disable(logging.CRITICAL)
    try:
        run_inference(args)
    except Exception:
        try:
            args.output_wav.unlink(missing_ok=True)
        except OSError:
            pass
        print("RVC inference failed", file=sys.stderr)
        return 1
    finally:
        logging.disable(previous_logging_disable)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

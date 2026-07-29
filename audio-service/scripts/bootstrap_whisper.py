#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Sequence
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.bootstrap_models import main as bootstrap_models_main

DEFAULT_MODELS_DIR = Path("/opt/bmo/models")


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    return bootstrap_models_main(["--model", "whisper", *arguments])


if __name__ == "__main__":
    raise SystemExit(main())

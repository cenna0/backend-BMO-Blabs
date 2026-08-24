#!/usr/bin/env python3
"""Verify the current BMO voice documentation points at the live contract."""

from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(sys.argv[2]).resolve() if len(sys.argv) == 3 and sys.argv[1] == "--root" else Path(__file__).resolve().parents[1]

CURRENT_DOCS = (
    ROOT / "docs/README.md",
    ROOT / "docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md",
    ROOT / "docs/hardware-handoff/README.md",
    ROOT / "docs/superpowers/specs/2026-08-24-piper-only-purge-design.md",
    ROOT / "docs/superpowers/plans/2026-08-24-piper-only-purge.md",
)

REQUIRED_DOC_TEXT = (
    "faster-whisper",
    "Hermes",
    "Piper",
    "FFmpeg",
    "MP3",
)


def main() -> int:
    errors: list[str] = []
    for path in CURRENT_DOCS:
        if not path.is_file():
            errors.append(f"missing current document: {path.relative_to(ROOT)}")
            continue
        text = path.read_text(encoding="utf-8")
        if path.name == "README.md" and path.parent.name == "docs":
            missing = [value for value in REQUIRED_DOC_TEXT if value not in text]
            errors.extend(f"docs/README.md missing current term: {value}" for value in missing)

    runtime = (ROOT / "audio-service/app/config.py").read_text(encoding="utf-8")
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    if 'tts_primary_engine: Literal["piper"]' not in runtime:
        errors.append("Audio Service does not pin Piper as its TTS engine")
    if 'TTS_PRIMARY_ENGINE: "piper"' not in compose and "TTS_PRIMARY_ENGINE: piper" not in compose:
        errors.append("production Compose does not select Piper")

    if errors:
        print("FAIL")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"PASS: verified {len(CURRENT_DOCS)} current BMO voice documents")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

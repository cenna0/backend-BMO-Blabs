from __future__ import annotations

from pathlib import Path
import argparse
import signal
import subprocess
import time

from .engine import PiperEngine
from .shutdown import ShutdownRequested, install_shutdown_handlers


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--phase", choices=("startup", "model-loading", "synthesis", "ffmpeg", "idle"), required=True
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--text", required=True)
    args = parser.parse_args()
    install_shutdown_handlers()
    output_root = args.output_root.resolve(strict=True)
    marker = output_root / f"{args.phase}.active"
    wav_path = output_root / "shutdown-synthesis.wav"
    mp3_path = output_root / "shutdown-ffmpeg.mp3"
    child: subprocess.Popen[bytes] | None = None
    try:
        if args.phase == "startup":
            marker.write_text("active\n", encoding="ascii")
            while True:
                signal.pause()
        if args.phase == "ffmpeg":
            child = subprocess.Popen(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-y",
                    "-v",
                    "error",
                    "-re",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:duration=120",
                    "-ac",
                    "1",
                    "-ar",
                    "24000",
                    "-b:a",
                    "96k",
                    str(mp3_path),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            marker.write_text("active\n", encoding="ascii")
            child.wait()
            return child.returncode
        if args.phase == "model-loading":
            marker.write_text("active\n", encoding="ascii")
        engine = PiperEngine(args.manifest, output_root)
        if args.phase == "synthesis":
            marker.write_text("active\n", encoding="ascii")
            engine.synthesize(args.text, wav_path, "prudence", 0)
            return 0
        if args.phase == "idle":
            marker.write_text("active\n", encoding="ascii")
            while True:
                signal.pause()
        while True:
            signal.pause()
    except ShutdownRequested:
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=2)
        wav_path.unlink(missing_ok=True)
        wav_path.with_name(wav_path.name + ".part").unlink(missing_ok=True)
        mp3_path.unlink(missing_ok=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

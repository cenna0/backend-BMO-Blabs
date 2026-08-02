from __future__ import annotations

from pathlib import Path
from typing import Any
import argparse
import json
import re
import sys

from .engine import PiperEngine
from .shutdown import ShutdownRequested, install_shutdown_handlers


class RequestError(RuntimeError):
    pass


REQUEST_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


def handle_request(
    engine: PiperEngine,
    payload: dict[str, Any],
    output_root: Path,
) -> dict[str, object]:
    if payload.get("operation") != "synthesize":
        raise RequestError("unsupported operation")
    request_id = payload.get("request_id")
    if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
        raise RequestError("invalid request ID")
    relative_output = payload.get("output_path")
    if not isinstance(relative_output, str):
        raise RequestError("invalid output path")
    relative_path = Path(relative_output)
    if relative_path.is_absolute() or ".." in relative_path.parts or relative_path.suffix != ".wav":
        raise RequestError("invalid output path")
    output_path = (output_root / relative_path).resolve()
    if output_root != output_path.parent and output_root not in output_path.parents:
        raise RequestError("output path escaped output root")
    if not output_path.parent.is_dir():
        raise RequestError("output parent does not exist")
    if payload.get("speaker_name") != "prudence" or payload.get("speaker_id") != 0:
        raise RequestError("invalid speaker")
    result = engine.synthesize(
        payload.get("text"), output_path, "prudence", 0
    )
    return {"event": "result", "request_id": request_id, **result}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()
    install_shutdown_handlers()
    try:
        output_root = args.output_root.resolve(strict=True)
        engine = PiperEngine(args.manifest, output_root)
        identity = engine.identity
        print(
            json.dumps(
                {
                    "event": "ready",
                    "load_seconds": engine.load_seconds,
                    "model_load_count": engine.model_load_count,
                    "speaker_name": identity.speaker_name,
                    "speaker_id": identity.speaker_id,
                    "sample_rate": identity.sample_rate,
                    "model_sha256": identity.model_sha256,
                    "config_sha256": identity.config_sha256,
                },
                separators=(",", ":"),
            ),
            flush=True,
        )
        for line in sys.stdin:
            if len(line.encode("utf-8")) > 16384:
                print('{"event":"error","error":"request too large"}', flush=True)
                continue
            try:
                payload = json.loads(line)
                if not isinstance(payload, dict):
                    raise RequestError("request must be an object")
                if payload.get("operation") == "shutdown":
                    return 0
                response = handle_request(engine, payload, output_root)
            except Exception as error:
                response = {
                    "event": "error",
                    "error": str(error) if isinstance(error, RequestError) else "synthesis failed",
                }
            print(json.dumps(response, separators=(",", ":")), flush=True)
        return 0
    except ShutdownRequested:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

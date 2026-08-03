from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from threading import Lock
import os
import sys
import time

from app.config import PIPER_SPEAKER_ID, PIPER_SPEAKER_NAME, Settings
from app.piper.audio import PiperAudioError, validate_piper_wav
from app.piper.process import PersistentWorker, WorkerError


WorkerFactory = Callable[..., PersistentWorker]


class PiperSynthesisError(RuntimeError):
    """A bounded, sanitized Piper failure eligible for Kokoro fallback."""


def _worker_environment() -> dict[str, str]:
    allowed = {
        "PATH",
        "HOME",
        "LANG",
        "LC_ALL",
        "PYTHONPATH",
        "PYTHONUNBUFFERED",
        "OMP_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "MKL_NUM_THREADS",
        "NUMEXPR_NUM_THREADS",
        "HF_HUB_OFFLINE",
        "TRANSFORMERS_OFFLINE",
        "HF_HUB_DISABLE_TELEMETRY",
        "MODEL_DOWNLOAD_ALLOWED",
        "ORT_DISABLE_ALL_NETWORK",
        "XDG_CACHE_HOME",
    }
    return {key: value for key, value in os.environ.items() if key in allowed}


class PiperSynthesizer:
    def __init__(
        self,
        settings: Settings,
        worker_factory: WorkerFactory | None = None,
    ) -> None:
        self._settings = settings
        self._worker_factory = worker_factory or PersistentWorker
        self._worker: PersistentWorker | None = None
        self._load_failed = False
        self._lock = Lock()
        self._worker_root = settings.tts_temp_dir.resolve()

    @property
    def ready(self) -> bool:
        return self._worker is not None and self._worker.returncode is None

    @property
    def health_status(self) -> str:
        if self.ready:
            return "ok"
        return "error" if self._load_failed else "loading"

    @property
    def model_load_count(self) -> int:
        if self._worker is None:
            return 0
        return int(self._worker.ready.get("model_load_count", 0))

    @property
    def worker_pid(self) -> int | None:
        return self._worker.pid if self._worker is not None else None

    def _ensure_worker(self) -> PersistentWorker:
        if self.ready:
            assert self._worker is not None
            return self._worker
        self._worker_root.mkdir(parents=True, exist_ok=True)
        command = [
            sys.executable,
            "-m",
            "app.piper.worker",
            "--manifest",
            str(self._settings.piper_manifest_path),
            "--output-root",
            str(self._worker_root),
        ]
        try:
            worker = self._worker_factory(
                command,
                timeout_seconds=self._settings.piper_worker_timeout_seconds,
                cleanup_root=self._settings.tts_temp_dir,
                env=_worker_environment(),
                cwd=Path(__file__).resolve().parents[1],
            )
        except Exception as error:
            self._load_failed = True
            raise PiperSynthesisError("Piper worker unavailable") from error
        self._worker = worker
        self._load_failed = False
        return worker

    def warm_up(self) -> None:
        with self._lock:
            self._ensure_worker()

    def synthesize_to_wav(self, text: str, output_path: Path) -> float:
        started = time.perf_counter()
        with self._lock:
            root = self._settings.tts_temp_dir.resolve()
            try:
                resolved_output = output_path.resolve()
                relative_output = resolved_output.relative_to(root)
            except (OSError, ValueError) as error:
                raise PiperSynthesisError("Piper output path is invalid") from error
            if resolved_output.exists() or not resolved_output.parent.is_dir():
                raise PiperSynthesisError("Piper output path is invalid")
            worker = self._ensure_worker()
            try:
                response = worker.request(
                    {
                        "operation": "synthesize",
                        "request_id": resolved_output.parent.name,
                        "text": text,
                        "output_path": relative_output.as_posix(),
                        "speaker_name": PIPER_SPEAKER_NAME,
                        "speaker_id": PIPER_SPEAKER_ID,
                    }
                )
                if response.get("event") != "result":
                    raise PiperSynthesisError("Piper returned an invalid response")
                returned_path = Path(str(response.get("output_path", ""))).resolve()
                if returned_path != resolved_output:
                    raise PiperSynthesisError("Piper returned an invalid output path")
                validate_piper_wav(resolved_output)
            except WorkerError as error:
                self._worker = None
                worker.close()
                raise PiperSynthesisError("Piper worker failed") from error
            except PiperAudioError as error:
                resolved_output.unlink(missing_ok=True)
                raise PiperSynthesisError("Piper returned invalid audio") from error
            except PiperSynthesisError:
                resolved_output.unlink(missing_ok=True)
                raise
            except Exception as error:
                resolved_output.unlink(missing_ok=True)
                raise PiperSynthesisError("Piper synthesis failed") from error
        return round(time.perf_counter() - started, 3)

    def close(self) -> None:
        with self._lock:
            worker, self._worker = self._worker, None
            if worker is not None:
                worker.close()

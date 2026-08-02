from __future__ import annotations

import ctypes
from pathlib import Path
import os
import signal
import stat
import subprocess
from threading import Thread
import time
from typing import BinaryIO, Callable, Sequence

from app.audio_validation import AudioValidationError, validate_rvc_wav
from app.config import Settings
from app.rvc_assets import (
    RVC_ENGINE_REPOSITORY,
    RVC_ENGINE_REVISION,
    RVC_SUPPORT_REPOSITORY,
    RVC_SUPPORT_REVISION,
    verify_runtime_manifest,
)


RVC_MODEL_REPO = "Freaky98/CGO-adventure-time-BMO-rvc-v2-420e"
RVC_MODEL_REVISION = "82a8bc529bd41b930589188ead30f073d4f99fc0"
RVC_MODEL_ARCHIVE = "CGO-adventure-time-BMO-rvc-v2-420e.zip"
RVC_MODEL_EXPECTED_SIZE = 63_780_149
RVC_MODEL_EXPECTED_SHA256 = "dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0"
RVC_RELATIVE_DIR = Path("rvc/bmo")

RVC_WORKER_COMMAND = (
    "/opt/rvc-venv/bin/python",
    "/app/scripts/rvc_infer.py",
)
_PR_SET_CHILD_SUBREAPER = 36


class RvcConversionError(RuntimeError):
    pass


class _BoundedCapture:
    def __init__(self, stream: BinaryIO | None, limit: int) -> None:
        self._stream = stream
        self._limit = limit
        self._tail = bytearray()
        self.total_bytes = 0
        self._thread = Thread(target=self._drain, daemon=True)

    @property
    def captured_bytes(self) -> int:
        return len(self._tail)

    @property
    def truncated(self) -> bool:
        return self.total_bytes > self._limit

    def start(self) -> None:
        self._thread.start()

    def join(self) -> None:
        self._thread.join(timeout=5)

    def _drain(self) -> None:
        if self._stream is None:
            return
        try:
            while True:
                chunk = self._stream.read(65_536)
                if not chunk:
                    break
                self.total_bytes += len(chunk)
                self._tail.extend(chunk)
                excess = len(self._tail) - self._limit
                if excess > 0:
                    del self._tail[:excess]
        finally:
            self._stream.close()


PopenFactory = Callable[..., subprocess.Popen[bytes]]
ManifestVerifier = Callable[[Path | None, dict[str, Path | None]], None]


def _is_regular_file(path: Path | None) -> bool:
    if path is None:
        return False
    try:
        return stat.S_ISREG(path.lstat().st_mode)
    except OSError:
        return False


def _is_executable_file(path: str) -> bool:
    try:
        resolved = Path(path).resolve(strict=True)
    except OSError:
        return False
    return resolved.is_file() and os.access(resolved, os.X_OK)


def _enable_child_subreaper() -> bool:
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        return libc.prctl(_PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) == 0
    except (AttributeError, OSError):
        return False


def _reap_process_group(process_group: int, *, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            child_pid, _status = os.waitpid(-process_group, os.WNOHANG)
        except ChildProcessError:
            return
        if child_pid == 0:
            time.sleep(0.01)


class RvcCommandConverter:
    def __init__(
        self,
        settings: Settings,
        *,
        popen_factory: PopenFactory | None = None,
        command_override: Sequence[str] | None = None,
        manifest_verifier: ManifestVerifier | None = None,
    ) -> None:
        self._settings = settings
        self._popen_factory = popen_factory or subprocess.Popen
        self._command = tuple(command_override or RVC_WORKER_COMMAND)
        self._command_is_override = command_override is not None
        self._manifest_verifier = manifest_verifier or verify_runtime_manifest
        self._manifest_verified = False
        self.error: str | None = None
        self.last_stdout_bytes = 0
        self.last_stderr_bytes = 0
        self.stdout_truncated = False
        self.stderr_truncated = False

    @property
    def available(self) -> bool:
        error = self._availability_error()
        self.error = error
        return error is None

    def _availability_error(self) -> str | None:
        if not self._settings.rvc_enabled:
            return "RVC disabled"
        if not _is_regular_file(self._settings.rvc_model_path):
            return "RVC model file unavailable"
        if not _is_regular_file(self._settings.rvc_hubert_path):
            return "RVC HuBERT file unavailable"
        if not _is_regular_file(self._settings.rvc_rmvpe_path):
            return "RVC RMVPE file unavailable"
        if self._settings.rvc_index_path is not None and not _is_regular_file(
            self._settings.rvc_index_path,
        ):
            return "RVC index file unavailable"
        if not self._settings.rvc_infer_command:
            return "RVC inference worker unavailable"
        if not self._command_is_override:
            if tuple(self._settings.rvc_infer_command.split(" ")) != RVC_WORKER_COMMAND:
                return "RVC inference worker unavailable"
            if not _is_executable_file(self._command[0]) or not _is_regular_file(
                Path(self._command[1]),
            ):
                return "RVC inference worker unavailable"
        if not self._manifest_verified:
            try:
                self._manifest_verifier(
                    self._settings.rvc_manifest_path,
                    {
                        "bmo_model": self._settings.rvc_model_path,
                        "bmo_index": self._settings.rvc_index_path,
                        "hubert": self._settings.rvc_hubert_path,
                        "rmvpe": self._settings.rvc_rmvpe_path,
                    },
                )
            except ValueError:
                if self._settings.rvc_manifest_path is None:
                    return "RVC candidate manifest unavailable"
                return "RVC candidate manifest invalid"
            self._manifest_verified = True
        self.error = None
        return None

    def _validate_paths(self, input_wav: Path, output_wav: Path) -> Path:
        if not _is_regular_file(input_wav):
            raise RvcConversionError("RVC input is unavailable")
        if output_wav.exists() or output_wav.is_symlink():
            raise RvcConversionError("RVC output path is not empty")
        try:
            temp_root = self._settings.tts_temp_dir.resolve(strict=True)
            input_parent = input_wav.parent.resolve(strict=True)
            output_parent = output_wav.parent.resolve(strict=True)
            input_parent.relative_to(temp_root)
        except (OSError, ValueError) as error:
            raise RvcConversionError("RVC temporary path is invalid") from error
        if input_parent != output_parent or output_wav.suffix.lower() != ".wav":
            raise RvcConversionError("RVC output path is invalid")
        return input_parent

    def _build_command(self, input_wav: Path, output_wav: Path) -> list[str]:
        command = [
            *self._command,
            "--model-path",
            str(self._settings.rvc_model_path),
            "--input-wav",
            str(input_wav),
            "--output-wav",
            str(output_wav),
            "--hubert-path",
            str(self._settings.rvc_hubert_path),
            "--rmvpe-path",
            str(self._settings.rvc_rmvpe_path),
            "--device",
            self._settings.rvc_device,
            "--f0-up-key",
            str(self._settings.rvc_f0_up_key),
            "--f0-method",
            self._settings.rvc_f0_method,
            "--index-rate",
            str(self._settings.rvc_index_rate),
            "--protect",
            str(self._settings.rvc_protect),
            "--rms-mix-rate",
            str(self._settings.rvc_rms_mix_rate),
        ]
        if self._settings.rvc_index_path is not None:
            command.extend(["--index-path", str(self._settings.rvc_index_path)])
        return command

    def _worker_environment(self, request_dir: Path) -> dict[str, str]:
        path_entries = [str(Path(self._command[0]).parent), "/usr/local/bin", "/usr/bin", "/bin"]
        cache_root = self._settings.xdg_cache_home
        try:
            cache_root.mkdir(mode=0o700, parents=True, exist_ok=True)
            resolved_cache_root = cache_root.resolve(strict=True)
            numba_cache = resolved_cache_root / "rvc-numba"
            numba_cache.mkdir(mode=0o700, exist_ok=True)
            if numba_cache.is_symlink() or numba_cache.resolve(strict=True).parent != resolved_cache_root:
                raise OSError("invalid RVC cache directory")
        except OSError:
            numba_cache = request_dir / ".numba-cache"
        index_root = (
            self._settings.rvc_index_path.parent
            if self._settings.rvc_index_path is not None
            else request_dir
        )
        return {
            "HOME": str(request_dir),
            "TMPDIR": str(request_dir),
            "PATH": ":".join(path_entries),
            "LANG": "C.UTF-8",
            "PYTHONHASHSEED": "0",
            "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "TORCH_FORCE_WEIGHTS_ONLY_LOAD": "1",
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "NUMBA_CACHE_DIR": str(numba_cache),
            "OMP_NUM_THREADS": str(self._settings.rvc_cpu_threads),
            "MKL_NUM_THREADS": str(self._settings.rvc_cpu_threads),
            "RVC_DEVICE": "cpu",
            "weight_root": str(self._settings.rvc_model_path.parent),
            "index_root": str(index_root),
            "hubert_path": str(self._settings.rvc_hubert_path),
            "rmvpe_root": str(self._settings.rvc_rmvpe_path.parent),
        }

    @staticmethod
    def _terminate_process_group(process: subprocess.Popen[bytes]) -> None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except (OSError, ProcessLookupError):
            process.terminate()
        try:
            process.wait(timeout=2)
            _reap_process_group(process.pid)
            return
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (OSError, ProcessLookupError):
            process.kill()
        process.wait(timeout=2)
        _reap_process_group(process.pid)

    def convert(self, input_wav: Path, output_wav: Path) -> float:
        if not self.available:
            raise RvcConversionError(self.error or "RVC unavailable")
        request_dir = self._validate_paths(input_wav, output_wav)
        command = self._build_command(input_wav, output_wav)
        started = time.perf_counter()
        try:
            try:
                _enable_child_subreaper()
                process = self._popen_factory(
                    command,
                    cwd=request_dir,
                    env=self._worker_environment(request_dir),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    start_new_session=True,
                    close_fds=True,
                )
            except OSError as error:
                raise RvcConversionError("RVC inference worker unavailable") from error

            stdout = _BoundedCapture(process.stdout, self._settings.rvc_capture_limit_bytes)
            stderr = _BoundedCapture(process.stderr, self._settings.rvc_capture_limit_bytes)
            stdout.start()
            stderr.start()
            try:
                returncode = process.wait(timeout=self._settings.rvc_timeout_seconds)
            except subprocess.TimeoutExpired as error:
                self._terminate_process_group(process)
                raise RvcConversionError("RVC inference timed out") from error
            finally:
                stdout.join()
                stderr.join()
                self.last_stdout_bytes = stdout.captured_bytes
                self.last_stderr_bytes = stderr.captured_bytes
                self.stdout_truncated = stdout.truncated
                self.stderr_truncated = stderr.truncated

            if returncode != 0:
                raise RvcConversionError("RVC inference failed")
            try:
                validate_rvc_wav(input_wav, output_wav, approved_dir=request_dir)
            except AudioValidationError as error:
                raise RvcConversionError("RVC produced invalid output") from error
            return round(time.perf_counter() - started, 3)
        except Exception:
            try:
                output_wav.unlink(missing_ok=True)
            except OSError:
                pass
            raise

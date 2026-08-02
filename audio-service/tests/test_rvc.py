from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
import pytest
import soundfile as sf

from app.config import Settings
from app.rvc import RvcCommandConverter, RvcConversionError
from tests.helpers import write_wav_file


EXACT_COMMAND = "/opt/rvc-venv/bin/python /app/scripts/rvc_infer.py"


def prepare_settings(tmp_path: Path, **overrides) -> tuple[Settings, Path, Path]:
    tmp_path.mkdir(parents=True, exist_ok=True)
    model = tmp_path / "model.pth"
    hubert = tmp_path / "hubert_base.pt"
    rmvpe = tmp_path / "rmvpe.pt"
    input_wav = write_wav_file(tmp_path / "input.wav", frames=24_000)
    output_wav = tmp_path / "output.wav"
    model.write_bytes(b"model")
    hubert.write_bytes(b"hubert")
    rmvpe.write_bytes(b"rmvpe")
    values = {
        "internal_service_token": "test-internal-token",
        "tts_temp_dir": tmp_path,
        "rvc_enabled": True,
        "rvc_model_path": model,
        "rvc_hubert_path": hubert,
        "rvc_rmvpe_path": rmvpe,
        "rvc_infer_command": EXACT_COMMAND,
        "rvc_timeout_seconds": 2,
        "xdg_cache_home": tmp_path / "cache",
    }
    values.update(overrides)
    return Settings(**values), input_wav, output_wav


def write_worker(path: Path, body: str) -> Path:
    path.write_text(body, encoding="utf-8")
    return path


def copy_worker(path: Path) -> Path:
    return write_worker(
        path,
        """
import argparse
import shutil

parser = argparse.ArgumentParser()
parser.add_argument('--input-wav', required=True)
parser.add_argument('--output-wav', required=True)
parser.add_argument('--model-path', required=True)
parser.add_argument('--hubert-path', required=True)
parser.add_argument('--rmvpe-path', required=True)
parser.add_argument('--device', required=True)
parser.add_argument('--f0-up-key', required=True)
parser.add_argument('--f0-method', required=True)
parser.add_argument('--index-rate', required=True)
parser.add_argument('--protect', required=True)
parser.add_argument('--rms-mix-rate', required=True)
parser.add_argument('--index-path')
args = parser.parse_args()
shutil.copyfile(args.input_wav, args.output_wav)
""",
    )


def make_converter(settings: Settings, worker: Path) -> RvcCommandConverter:
    return RvcCommandConverter(
        settings,
        command_override=(sys.executable, str(worker)),
        manifest_verifier=lambda _manifest, _paths: None,
    )


def test_rvc_converter_is_unavailable_when_disabled(tmp_path):
    settings, _, _ = prepare_settings(tmp_path, rvc_enabled=False)
    converter = RvcCommandConverter(settings)

    assert converter.available is False
    assert converter.error == "RVC disabled"


@pytest.mark.parametrize(
    ("override", "expected"),
    [
        ({"rvc_model_path": None}, "model"),
        ({"rvc_hubert_path": None}, "HuBERT"),
        ({"rvc_rmvpe_path": None}, "RMVPE"),
        ({"rvc_infer_command": None}, "worker"),
    ],
)
def test_rvc_converter_reports_missing_required_component(tmp_path, override, expected):
    settings, _, _ = prepare_settings(tmp_path, **override)
    converter = RvcCommandConverter(settings)

    assert converter.available is False
    assert expected in (converter.error or "")


def test_rvc_converter_supports_an_optional_missing_index(tmp_path):
    settings, _, _ = prepare_settings(tmp_path, rvc_index_path=None)
    worker = copy_worker(tmp_path / "optional_index.py")

    assert make_converter(settings, worker).available is True


def test_rvc_converter_rejects_a_configured_missing_index(tmp_path):
    settings, _, _ = prepare_settings(
        tmp_path,
        rvc_index_path=tmp_path / "missing.index",
    )
    converter = RvcCommandConverter(settings)

    assert converter.available is False
    assert converter.error == "RVC index file unavailable"


def test_rvc_converter_requires_candidate_manifest_when_enabled(tmp_path):
    settings, _, _ = prepare_settings(tmp_path)
    worker = copy_worker(tmp_path / "worker.py")
    converter = RvcCommandConverter(
        settings,
        command_override=(sys.executable, str(worker)),
    )

    assert converter.available is False
    assert converter.error == "RVC candidate manifest unavailable"


def test_rvc_converter_builds_safe_exact_argv_for_paths_with_spaces_and_metacharacters(
    tmp_path,
):
    root = tmp_path / "space ; touch SHOULD_NOT_EXIST"
    settings, input_wav, output_wav = prepare_settings(root)
    index = root / "voice $(touch ALSO_NOT).index"
    index.write_bytes(b"index")
    settings = settings.model_copy(update={"rvc_index_path": index})
    argv_log = root / "argv.json"
    worker = write_worker(
        root / "worker script.py",
        f"""
import json
import shutil
import sys

open({str(argv_log)!r}, 'w', encoding='utf-8').write(json.dumps(sys.argv[1:]))
output = sys.argv[sys.argv.index('--output-wav') + 1]
input_path = sys.argv[sys.argv.index('--input-wav') + 1]
shutil.copyfile(input_path, output)
""",
    )
    converter = make_converter(settings, worker)

    converter.convert(input_wav, output_wav)

    assert json.loads(argv_log.read_text(encoding="utf-8")) == [
        "--model-path",
        str(settings.rvc_model_path),
        "--input-wav",
        str(input_wav),
        "--output-wav",
        str(output_wav),
        "--hubert-path",
        str(settings.rvc_hubert_path),
        "--rmvpe-path",
        str(settings.rvc_rmvpe_path),
        "--device",
        "cpu",
        "--f0-up-key",
        "0",
        "--f0-method",
        "rmvpe",
        "--index-rate",
        "0.75",
        "--protect",
        "0.33",
        "--rms-mix-rate",
        "0.25",
        "--index-path",
        str(index),
    ]
    assert not (tmp_path / "SHOULD_NOT_EXIST").exists()
    assert not (root / "ALSO_NOT").exists()


def test_rvc_subprocess_receives_only_allowlisted_environment(tmp_path):
    settings, input_wav, output_wav = prepare_settings(tmp_path)
    env_log = tmp_path / "env.json"
    worker = write_worker(
        tmp_path / "env_worker.py",
        f"""
import json
import os
import shutil
import sys

open({str(env_log)!r}, 'w', encoding='utf-8').write(json.dumps(dict(os.environ)))
shutil.copyfile(sys.argv[sys.argv.index('--input-wav') + 1], sys.argv[sys.argv.index('--output-wav') + 1])
""",
    )
    converter = make_converter(settings, worker)
    previous = os.environ.get("DEVICE_TOKEN")
    os.environ["DEVICE_TOKEN"] = "must-not-cross-boundary"
    os.environ["INTERNAL_SERVICE_TOKEN"] = "must-not-cross-boundary"
    try:
        converter.convert(input_wav, output_wav)
    finally:
        if previous is None:
            os.environ.pop("DEVICE_TOKEN", None)
        else:
            os.environ["DEVICE_TOKEN"] = previous
        os.environ.pop("INTERNAL_SERVICE_TOKEN", None)

    child_env = json.loads(env_log.read_text(encoding="utf-8"))
    assert "DEVICE_TOKEN" not in child_env
    assert "INTERNAL_SERVICE_TOKEN" not in child_env
    assert child_env["TORCH_FORCE_WEIGHTS_ONLY_LOAD"] == "1"
    assert child_env["HF_HUB_OFFLINE"] == "1"
    assert child_env["RVC_DEVICE"] == "cpu"
    assert child_env["NUMBA_CACHE_DIR"] == str((tmp_path / "cache/rvc-numba").resolve())
    assert child_env["OMP_NUM_THREADS"] == "4"
    assert child_env["MKL_NUM_THREADS"] == "4"


def test_rvc_converter_passes_tuned_values_as_fixed_argv_elements(tmp_path):
    settings, input_wav, output_wav = prepare_settings(
        tmp_path,
        rvc_index_rate=1.0,
        rvc_protect=0.5,
        rvc_rms_mix_rate=0.75,
        rvc_cpu_threads=1,
    )
    argv_log = tmp_path / "tuned-argv.json"
    worker = write_worker(
        tmp_path / "tuned_worker.py",
        f"""
import json
import shutil
import sys
open({str(argv_log)!r}, 'w', encoding='utf-8').write(json.dumps(sys.argv[1:]))
shutil.copyfile(sys.argv[sys.argv.index('--input-wav') + 1], sys.argv[sys.argv.index('--output-wav') + 1])
""",
    )

    make_converter(settings, worker).convert(input_wav, output_wav)

    argv = json.loads(argv_log.read_text(encoding="utf-8"))
    assert argv[argv.index("--index-rate") + 1] == "1.0"
    assert argv[argv.index("--protect") + 1] == "0.5"
    assert argv[argv.index("--rms-mix-rate") + 1] == "0.75"


def test_rvc_converter_sanitizes_nonzero_exit_and_bounds_stderr(tmp_path):
    settings, input_wav, output_wav = prepare_settings(
        tmp_path,
        rvc_capture_limit_bytes=1_024,
    )
    worker = write_worker(
        tmp_path / "failure.py",
        """
import sys
sys.stderr.write('secret-token /private/path ' + ('x' * 100_000))
raise SystemExit(7)
""",
    )
    converter = make_converter(settings, worker)

    with pytest.raises(RvcConversionError) as caught:
        converter.convert(input_wav, output_wav)

    assert str(caught.value) == "RVC inference failed"
    assert converter.last_stderr_bytes <= 1_024
    assert converter.stderr_truncated is True
    assert not output_wav.exists()


def test_rvc_converter_times_out_and_terminates_the_process_tree(tmp_path):
    settings, input_wav, output_wav = prepare_settings(
        tmp_path,
        rvc_timeout_seconds=0.2,
    )
    child_pid_file = tmp_path / "child.pid"
    worker = write_worker(
        tmp_path / "timeout.py",
        f"""
import subprocess
import time

child = subprocess.Popen(['sleep', '60'])
open({str(child_pid_file)!r}, 'w', encoding='utf-8').write(str(child.pid))
time.sleep(60)
""",
    )
    converter = make_converter(settings, worker)

    with pytest.raises(RvcConversionError, match="timed out"):
        converter.convert(input_wav, output_wav)

    child_pid = int(child_pid_file.read_text(encoding="utf-8"))
    deadline = time.monotonic() + 2
    while Path(f"/proc/{child_pid}").exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert not Path(f"/proc/{child_pid}").exists()
    assert not output_wav.exists()


@pytest.mark.parametrize("mode", ["missing", "empty", "malformed", "nan", "duration"])
def test_rvc_converter_rejects_invalid_output_wav(tmp_path, mode):
    settings, input_wav, output_wav = prepare_settings(tmp_path)
    if mode == "missing":
        action = "pass"
    elif mode == "empty":
        action = "open(output, 'wb').close()"
    elif mode == "malformed":
        action = "open(output, 'wb').write(b'not wav')"
    elif mode == "nan":
        action = (
            "import numpy as np, soundfile as sf; "
            "sf.write(output, np.full(40000, np.nan, dtype=np.float32), 40000, "
            "format='WAV', subtype='FLOAT')"
        )
    else:
        action = (
            "import numpy as np, soundfile as sf; "
            "sf.write(output, np.zeros(200000, dtype=np.float32), 40000, "
            "format='WAV', subtype='FLOAT')"
        )
    worker = write_worker(
        tmp_path / f"invalid_{mode}.py",
        f"""
import sys
output = sys.argv[sys.argv.index('--output-wav') + 1]
{action}
""",
    )
    converter = make_converter(settings, worker)

    with pytest.raises(RvcConversionError, match="invalid output"):
        converter.convert(input_wav, output_wav)

    assert not output_wav.exists()


def test_rvc_converter_accepts_valid_output_and_records_timing(tmp_path):
    settings, input_wav, output_wav = prepare_settings(tmp_path)
    converter = make_converter(settings, copy_worker(tmp_path / "success.py"))

    seconds = converter.convert(input_wav, output_wav)

    assert seconds >= 0
    assert output_wav.is_file()

from pathlib import Path
import subprocess

from app.config import Settings
from app.rvc import RvcCommandConverter
from tests.helpers import write_wav_file


def test_rvc_command_converter_uses_rvc_infer_cli_shape(tmp_path, monkeypatch):
    model = tmp_path / "model.pth"
    index = tmp_path / "model.index"
    input_wav = write_wav_file(tmp_path / "input.wav")
    output_wav = tmp_path / "output.wav"
    model.write_bytes(b"model")
    index.write_bytes(b"index")
    commands = []

    def fake_run(command, **kwargs):
        commands.append(command)
        output_wav.write_bytes(b"wav")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    converter = RvcCommandConverter(
        Settings(
            internal_service_token="test-internal-token",
            rvc_enabled=True,
            rvc_model_path=model,
            rvc_index_path=index,
            rvc_infer_command="rvc infer",
        ),
    )

    seconds = converter.convert(input_wav, output_wav)

    assert seconds >= 0
    assert commands == [
        [
            "rvc",
            "infer",
            "-m",
            str(model),
            "-i",
            str(input_wav),
            "-o",
            str(output_wav),
            "-fu",
            "0",
            "-fm",
            "rmvpe",
            "-if",
            str(index),
        ],
    ]

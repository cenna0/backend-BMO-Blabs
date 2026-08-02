from pathlib import Path
import json

import pytest

from app.config import Settings
from app.ffmpeg import FfmpegConverter, probe_audio
from tests.helpers import write_wav_file


class Completed:
    def __init__(self, *, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_ffmpeg_converter_uses_canonical_mp3_command(tmp_path):
    commands = []

    def runner(command, **kwargs):
        commands.append(command)
        if command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"mp3")
            return Completed()
        return Completed(
            stdout=json.dumps(
                {
                    "streams": [
                        {
                            "codec_name": "mp3",
                            "sample_rate": "24000",
                            "channels": 1,
                            "bit_rate": "96000",
                            "duration": "0.1",
                        },
                    ],
                },
            ),
        )

    converter = FfmpegConverter(
        Settings(internal_service_token="test-internal-token"),
        runner=runner,
    )
    input_wav = write_wav_file(tmp_path / "input.wav")
    output_mp3 = tmp_path / "output.mp3"

    seconds = converter.convert_wav_to_mp3(input_wav, output_mp3)

    assert seconds >= 0
    assert output_mp3.read_bytes() == b"mp3"
    assert commands == [
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(input_wav),
            "-ac",
            "1",
            "-ar",
            "24000",
            "-b:a",
            "96k",
            str(output_mp3),
        ],
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,sample_rate,channels,bit_rate,duration",
            "-of",
            "json",
            str(output_mp3),
        ],
    ]


def test_ffmpeg_warmup_caches_mandatory_readiness():
    commands = []

    def runner(command, **kwargs):
        commands.append(command)
        return Completed()

    converter = FfmpegConverter(
        Settings(internal_service_token="test-internal-token"),
        runner=runner,
    )

    assert converter.ready is False
    converter.warm_up()
    converter.warm_up()

    assert converter.ready is True
    assert commands == [["ffmpeg", "-version"]]


def test_ffmpeg_converter_rejects_incompatible_probe_metadata(tmp_path):
    def runner(command, **kwargs):
        if command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"mp3")
            return Completed()
        return Completed(
            stdout=json.dumps(
                {
                    "streams": [
                        {
                            "codec_name": "aac",
                            "sample_rate": "44100",
                            "channels": 2,
                            "bit_rate": "128000",
                            "duration": "1.0",
                        },
                    ],
                },
            ),
        )

    converter = FfmpegConverter(
        Settings(internal_service_token="test-internal-token"),
        runner=runner,
    )
    input_wav = write_wav_file(tmp_path / "input.wav")

    with pytest.raises(RuntimeError, match="invalid MP3 output"):
        converter.convert_wav_to_mp3(input_wav, tmp_path / "output.mp3")


def test_probe_audio_sanitizes_ffprobe_failure(tmp_path):
    path = tmp_path / "private-name.mp3"
    path.write_bytes(b"broken")

    with pytest.raises(RuntimeError) as caught:
        probe_audio(
            path,
            runner=lambda *_args, **_kwargs: Completed(
                returncode=1,
                stderr="secret-token /private/path",
            ),
        )

    assert str(caught.value) == "ffprobe failed"
    assert "secret-token" not in str(caught.value)

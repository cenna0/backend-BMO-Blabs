from pathlib import Path

from app.config import Settings
from app.ffmpeg import FfmpegConverter
from tests.helpers import write_wav_file


class Completed:
    returncode = 0
    stderr = ""


def test_ffmpeg_converter_uses_canonical_mp3_command(tmp_path):
    commands = []

    def runner(command, **kwargs):
        commands.append(command)
        Path(command[-1]).write_bytes(b"mp3")
        return Completed()

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

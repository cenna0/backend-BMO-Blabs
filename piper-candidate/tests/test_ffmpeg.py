from pathlib import Path
import subprocess
import wave

import pytest

from bmo_piper.ffmpeg import FfmpegError, convert_wav_to_mp3


class Result:
    def __init__(self, returncode=0, stderr=""):
        self.returncode = returncode
        self.stderr = stderr


def test_ffmpeg_uses_fixed_contract_command(tmp_path):
    commands = []
    source = tmp_path / "source.wav"
    target = tmp_path / "target.mp3"
    source.write_bytes(b"wav")

    def runner(command, **kwargs):
        commands.append((command, kwargs))
        target.write_bytes(b"mp3")
        return Result()

    elapsed = convert_wav_to_mp3(source, target, runner=runner)

    assert elapsed >= 0
    assert commands[0][0] == [
        "ffmpeg",
        "-nostdin",
        "-y",
        "-v",
        "error",
        "-i",
        str(source),
        "-ac",
        "1",
        "-ar",
        "24000",
        "-b:a",
        "96k",
        str(target),
    ]
    assert commands[0][1]["timeout"] == 30


def test_ffmpeg_failure_removes_partial_output(tmp_path):
    source = tmp_path / "source.wav"
    target = tmp_path / "target.mp3"
    source.write_bytes(b"wav")

    def runner(_command, **_kwargs):
        target.write_bytes(b"partial")
        return Result(1, "private/path detail")

    with pytest.raises(FfmpegError, match="conversion failed"):
        convert_wav_to_mp3(source, target, runner=runner)

    assert not target.exists()


def test_ffmpeg_timeout_removes_partial_output(tmp_path):
    source = tmp_path / "source.wav"
    target = tmp_path / "target.mp3"
    source.write_bytes(b"wav")

    def runner(command, **_kwargs):
        target.write_bytes(b"partial")
        raise subprocess.TimeoutExpired(command, 0.01)

    with pytest.raises(FfmpegError, match="timeout"):
        convert_wav_to_mp3(source, target, runner=runner)

    assert not target.exists()


def test_real_ffmpeg_child_timeout_is_bounded_and_cleans_output(tmp_path):
    source = tmp_path / "source.wav"
    target = tmp_path / "target.mp3"
    with wave.open(str(source), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(22050)
        wav_file.writeframes(b"\x01\x00" * 22050)

    with pytest.raises(FfmpegError, match="timeout"):
        convert_wav_to_mp3(source, target, timeout_seconds=0.0001)

    assert not target.exists()

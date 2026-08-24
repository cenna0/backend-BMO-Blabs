#!/usr/bin/env python3
"""Optional runtime-image smoke test for the pinned Piper/FFmpeg stack."""

from __future__ import annotations

import os
import subprocess
import unittest


IMAGE = os.environ.get("P7_AUDIO_RUNTIME_IMAGE")


@unittest.skipUnless(
    IMAGE,
    "set P7_AUDIO_RUNTIME_IMAGE to run the audio runtime-image dependency check",
)
class AudioRuntimeDependencyTests(unittest.TestCase):
    def test_piper_and_ffmpeg_are_available_without_network(self) -> None:
        script = """
import shutil
import piper

assert piper is not None
assert shutil.which("ffmpeg")
assert shutil.which("ffprobe")
print("PIPER_FFMPEG_RUNTIME=PASS")
"""
        result = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--read-only",
                "--user",
                "10001:10001",
                "--cap-drop",
                "ALL",
                "--security-opt",
                "no-new-privileges:true",
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,nodev,size=64m,uid=10001,gid=10001,mode=1777",
                "--entrypoint",
                "python",
                IMAGE,
                "-c",
                script,
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )
        self.assertEqual(
            result.returncode,
            0,
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        self.assertEqual(result.stdout.strip(), "PIPER_FFMPEG_RUNTIME=PASS")


if __name__ == "__main__":
    unittest.main()

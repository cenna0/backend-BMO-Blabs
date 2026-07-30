#!/usr/bin/env python3
"""Runtime-image check for Kokoro's offline English G2P dependency."""

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
    def test_kokoro_english_pipeline_initializes_without_download_fallback(self) -> None:
        script = r"""
import importlib.metadata
import socket

import spacy
import spacy.cli

assert importlib.metadata.version("en-core-web-sm") == "3.8.0"

def reject_download(*_args, **_kwargs):
    raise AssertionError("runtime attempted spaCy model download")

def reject_network(*_args, **_kwargs):
    raise AssertionError("runtime attempted network access")

spacy.cli.download = reject_download
socket.create_connection = reject_network
nlp = spacy.load("en_core_web_sm")
assert nlp.meta["name"] == "core_web_sm"
assert nlp.meta["version"] == "3.8.0"

from kokoro import KPipeline

pipeline = KPipeline(
    lang_code="a",
    repo_id="hexgrad/Kokoro-82M",
    model=False,
)
assert pipeline.g2p is not None
print("OFFLINE_ENGLISH_DEPENDENCY=PASS")
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
        self.assertEqual(result.stdout.strip(), "OFFLINE_ENGLISH_DEPENDENCY=PASS")


if __name__ == "__main__":
    unittest.main()

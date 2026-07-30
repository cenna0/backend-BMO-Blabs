#!/usr/bin/env python3
"""Static and rendered-Compose checks for the P7 production packaging."""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BACKEND_DOCKERFILE = ROOT / "backend" / "Dockerfile"
AUDIO_DOCKERFILE = ROOT / "audio-service" / "Dockerfile"
COMPOSE_FILE = ROOT / "docker-compose.yml"
RUNTIME_LOCK = ROOT / "audio-service" / "requirements-runtime.lock"
AUDIO_REQUIREMENTS = ROOT / "audio-service" / "requirements.txt"
EN_CORE_WEB_SM_REQUIREMENT = (
    "en-core-web-sm @ "
    "https://github.com/explosion/spacy-models/releases/download/"
    "en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"
    "#sha256=1932429db727d4bff3deed6b34cfc05df17794f4a52eeb26cf8928f7c1a0fb85"
)

SHA256_IMAGE = re.compile(
    r"^FROM\s+\S+:[^\s@]+@sha256:[0-9a-f]{64}(?:\s+AS\s+\S+)?$",
    re.MULTILINE,
)
EXACT_REQUIREMENT = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9.,_-]+\])?==[^\s;]+"
    r"(?:\s*;\s*.+)?$"
)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class DockerfilePackagingTests(unittest.TestCase):
    def test_backend_image_is_pinned_built_and_runs_non_root(self) -> None:
        dockerfile = read(BACKEND_DOCKERFILE)

        self.assertGreaterEqual(len(SHA256_IMAGE.findall(dockerfile)), 2)
        self.assertIn("node:22.23.1-bookworm-slim@sha256:", dockerfile)
        self.assertIn("COPY package.json package-lock.json", dockerfile)
        self.assertGreaterEqual(dockerfile.count("npm ci"), 2)
        self.assertIn("npm run build", dockerfile)
        self.assertIn("npm ci --omit=dev", dockerfile)
        self.assertRegex(dockerfile, r"(?m)^USER\s+node$")
        self._assert_revision_label(dockerfile)
        self._assert_liveness_healthcheck(dockerfile)

    def test_audio_image_is_pinned_locked_and_runs_non_root(self) -> None:
        dockerfile = read(AUDIO_DOCKERFILE)

        self.assertEqual(len(SHA256_IMAGE.findall(dockerfile)), 1)
        self.assertIn("python:3.10.20-slim-bookworm@sha256:", dockerfile)
        self.assertIn("requirements-runtime.lock", dockerfile)
        self.assertRegex(
            dockerfile,
            r"pip install\s+--no-cache-dir\s+--requirement requirements-runtime\.lock",
        )
        self.assertIn('spacy.load("en_core_web_sm")', dockerfile)
        self.assertIn("ffmpeg", dockerfile)
        self.assertIn("libsndfile1", dockerfile)
        self.assertRegex(dockerfile, r"(?m)^USER\s+bmo$")
        self._assert_revision_label(dockerfile)
        self._assert_liveness_healthcheck(dockerfile)

    def test_docker_contexts_exclude_sensitive_and_development_inputs(self) -> None:
        for relative_path in ("backend/.dockerignore", "audio-service/.dockerignore"):
            ignore = read(ROOT / relative_path)
            self.assertRegex(ignore, r"(?m)^\.env\*$")
            self.assertRegex(ignore, r"(?m)^\.git$")
            self.assertRegex(ignore, r"(?m)^tests$")

        self.assertRegex(read(ROOT / "backend/.dockerignore"), r"(?m)^node_modules$")
        audio_ignore = read(ROOT / "audio-service/.dockerignore")
        self.assertRegex(audio_ignore, r"(?m)^\.venv$")
        self.assertRegex(audio_ignore, r"(?m)^models$")

    def test_runtime_lock_is_exact_and_preserves_direct_dependencies(self) -> None:
        lock_lines = [
            line.strip()
            for line in read(RUNTIME_LOCK).splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        self.assertEqual(
            lock_lines[0],
            "--extra-index-url https://download.pytorch.org/whl/cpu",
        )
        requirements = lock_lines[1:]

        self.assertGreater(len(requirements), 7)
        for requirement in requirements:
            if requirement == EN_CORE_WEB_SM_REQUIREMENT:
                continue
            self.assertRegex(requirement, EXACT_REQUIREMENT)

        normalized = {line.lower() for line in requirements}
        for direct in (
            "fastapi==0.139.2",
            "uvicorn==0.51.0",
            "pydantic-settings==2.14.2",
            "faster-whisper==1.2.1",
            "kokoro==0.9.4",
            "soundfile==0.13.1",
            "huggingface-hub==1.24.0",
        ):
            self.assertIn(direct, normalized)
        self.assertIn("spacy==3.8.14", normalized)
        self.assertIn("misaki==0.9.4", normalized)
        self.assertEqual(requirements.count(EN_CORE_WEB_SM_REQUIREMENT), 1)

        direct_requirements = {
            line.strip()
            for line in read(AUDIO_REQUIREMENTS).splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }
        self.assertIn(EN_CORE_WEB_SM_REQUIREMENT, direct_requirements)

    def test_packaging_files_do_not_contain_secret_values(self) -> None:
        paths = (
            BACKEND_DOCKERFILE,
            AUDIO_DOCKERFILE,
            COMPOSE_FILE,
            ROOT / "backend" / ".dockerignore",
            ROOT / "audio-service" / ".dockerignore",
        )
        combined = "\n".join(read(path) for path in paths)

        self.assertNotRegex(
            combined,
            r"(?i)(?:api[_-]?key|device[_-]?token|service[_-]?token|password)"
            r"\s*[:=]\s*[\"']?[A-Za-z0-9+/_.-]{8,}",
        )
        self.assertNotIn("118f02c07ea97f16e23b9183d1a050c73f190be7", combined)

    def _assert_revision_label(self, dockerfile: str) -> None:
        self.assertRegex(dockerfile, r"(?m)^ARG\s+VCS_REF$")
        self.assertRegex(
            dockerfile,
            r"org\.opencontainers\.image\.revision=[\"']?\$\{?VCS_REF\}?",
        )

    def _assert_liveness_healthcheck(self, dockerfile: str) -> None:
        healthcheck = next(
            line for line in dockerfile.splitlines() if line.startswith("HEALTHCHECK ")
        )
        self.assertIn("/livez", healthcheck)
        self.assertNotIn("/readyz", healthcheck)
        self.assertNotRegex(healthcheck, r"/health(?:[\"'\s]|$)")


class ComposePackagingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with tempfile.TemporaryDirectory(prefix="bmo-p7-compose-") as fixture_dir:
            fixture_root = Path(fixture_dir)
            backend_env = fixture_root / "backend.env"
            audio_env = fixture_root / "audio.env"
            backend_env.write_text("P7_PACKAGING_FIXTURE=true\n", encoding="utf-8")
            audio_env.write_text("P7_PACKAGING_FIXTURE=true\n", encoding="utf-8")

            environment = os.environ.copy()
            environment.update(
                {
                    "BACKEND_ENV_FILE": str(backend_env),
                    "AUDIO_ENV_FILE": str(audio_env),
                    "BACKEND_IMAGE": "bmo-backend@sha256:" + ("a" * 64),
                    "AUDIO_IMAGE": "bmo-audio@sha256:" + ("b" * 64),
                }
            )
            result = subprocess.run(
                [
                    "docker",
                    "compose",
                    "--file",
                    str(COMPOSE_FILE),
                    "config",
                    "--format",
                    "json",
                ],
                cwd=ROOT,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )
            if result.returncode:
                raise AssertionError(
                    "docker compose config failed:\n"
                    f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
                )
            cls.config = json.loads(result.stdout)

    def test_backend_uses_host_network_without_published_ports(self) -> None:
        backend = self.config["services"]["backend"]

        self.assertEqual(backend["network_mode"], "host")
        self.assertNotIn("ports", backend)
        self.assertEqual(backend["environment"]["BACKEND_HOST"], "127.0.0.1")
        self.assertEqual(backend["environment"]["BACKEND_PORT"], "3000")
        self.assertEqual(
            backend["environment"]["HERMES_API_URL"], "http://127.0.0.1:8642"
        )
        self.assertEqual(
            backend["environment"]["AUDIO_SERVICE_URL"], "http://127.0.0.1:8001"
        )

    def test_audio_publishes_only_the_host_loopback_port(self) -> None:
        audio = self.config["services"]["audio"]

        self.assertEqual(
            audio["ports"],
            [
                {
                    "mode": "ingress",
                    "target": 8001,
                    "published": "8001",
                    "protocol": "tcp",
                    "host_ip": "127.0.0.1",
                }
            ],
        )
        self.assertEqual(audio["environment"]["AUDIO_SERVICE_PORT"], "8001")
        self.assertEqual(audio["environment"]["RVC_ENABLED"], "false")
        self.assertEqual(audio["environment"]["MODEL_DOWNLOAD_ALLOWED"], "false")

    def test_runtime_mounts_are_minimal_and_models_are_read_only(self) -> None:
        backend = self.config["services"]["backend"]
        audio = self.config["services"]["audio"]

        self.assertEqual(
            self._bind_mounts(backend),
            {
                "/opt/bmo/temp/audio": ("/opt/bmo/temp/audio", False),
            },
        )
        self.assertEqual(
            self._bind_mounts(audio),
            {
                "/opt/bmo/models/runtime": ("/opt/bmo/models/runtime", True),
                "/opt/bmo/cache/audio": ("/opt/bmo/cache/audio", False),
                "/opt/bmo/temp/tts": ("/opt/bmo/temp/tts", False),
            },
        )
        self.assertTrue(backend["read_only"])
        self.assertTrue(audio["read_only"])
        self.assertTrue(any(entry.startswith("/tmp:") for entry in backend["tmpfs"]))
        self.assertTrue(any(entry.startswith("/tmp:") for entry in audio["tmpfs"]))

    def test_restart_logging_and_security_policies_are_fixed(self) -> None:
        for service in self.config["services"].values():
            self.assertEqual(service["restart"], "unless-stopped")
            self.assertEqual(service["logging"]["driver"], "json-file")
            self.assertEqual(
                service["logging"]["options"], {"max-file": "3", "max-size": "10m"}
            )
            self.assertEqual(service["cap_drop"], ["ALL"])
            self.assertIn("no-new-privileges:true", service["security_opt"])
            self.assertFalse(service.get("privileged", False))
            self.assertNotIn("build", service)
            self.assertNotIn("healthcheck", service)
            self.assertRegex(service["image"], r"@sha256:[0-9a-f]{64}$")

    @staticmethod
    def _bind_mounts(service: dict[str, object]) -> dict[str, tuple[str, bool]]:
        return {
            mount["source"]: (mount["target"], mount.get("read_only", False))
            for mount in service["volumes"]
            if mount["type"] == "bind"
        }


if __name__ == "__main__":
    unittest.main()

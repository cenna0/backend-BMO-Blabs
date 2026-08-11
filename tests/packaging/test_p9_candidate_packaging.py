#!/usr/bin/env python3
"""Static and rendered-Compose checks for the integrated P9 candidate."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILE = ROOT / "p9.1-compose.yml"
DOCKERFILE = ROOT / "backend" / "Dockerfile.p9.1"


class P9CandidatePackagingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with tempfile.TemporaryDirectory(prefix="bmo-p9-compose-") as fixture_dir:
            fixture_root = Path(fixture_dir)
            backend_env = fixture_root / "backend.env"
            password_file = fixture_root / "postgres-password"
            data_dir = fixture_root / "postgres-data"
            backend_env.write_text("P9_PACKAGING_FIXTURE=true\n", encoding="utf-8")
            password_file.write_text("test-only-placeholder\n", encoding="utf-8")
            data_dir.mkdir()
            environment = os.environ.copy()
            environment.update(
                {
                    "BACKEND_ENV_FILE": str(backend_env),
                    "P9_POSTGRES_PASSWORD_FILE": str(password_file),
                    "P9_DATA_DIR": str(data_dir),
                    "P9_JWT_SECRET": "j" * 32,
                    "P9_PAIRING_PEPPER": "p" * 32,
                    "P9_CANDIDATE_IMAGE": "bmo-p9.1-candidate:test",
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

    def test_postgres_has_no_host_published_port(self) -> None:
        postgres = self.config["services"]["postgres"]

        self.assertNotIn("ports", postgres)
        self.assertEqual(postgres["networks"], {"p9_private": None})

    def test_backend_and_postgres_share_only_the_named_socket_volume(self) -> None:
        backend = self.config["services"]["backend"]
        postgres = self.config["services"]["postgres"]

        self.assertEqual(backend["network_mode"], "host")
        self.assertEqual(
            backend["environment"]["P9_POSTGRES_SOCKET_DIR"],
            "/var/run/postgresql",
        )
        for service in (backend, postgres):
            socket_mounts = [
                mount
                for mount in service["volumes"]
                if mount["target"] == "/var/run/postgresql"
            ]
            self.assertEqual(len(socket_mounts), 1)
            self.assertEqual(socket_mounts[0]["type"], "volume")
            self.assertEqual(socket_mounts[0]["source"], "p9_postgres_socket")

        self.assertIn("p9_postgres_socket", self.config["volumes"])

    def test_backend_has_private_writable_persistent_avatar_storage(self) -> None:
        backend = self.config["services"]["backend"]
        mounts = [
            mount for mount in backend["volumes"]
            if mount["target"] == "/opt/bmo/data/avatars"
        ]
        self.assertEqual(len(mounts), 1)
        self.assertEqual(mounts[0]["type"], "volume")
        self.assertEqual(mounts[0]["source"], "p9_avatar_data")
        self.assertFalse(mounts[0].get("read_only", False))
        self.assertEqual(
            backend["environment"]["AVATAR_STORAGE_DIR"],
            "/opt/bmo/data/avatars",
        )
        self.assertNotIn("ports", backend)
        self.assertIn("p9_avatar_data", self.config["volumes"])

    def test_candidate_image_seeds_avatar_volume_with_runtime_ownership(self) -> None:
        dockerfile = DOCKERFILE.read_text(encoding="utf-8")
        self.assertIn(
            "install -d -o 1000 -g 1000 -m 0700 /opt/bmo/data/avatars",
            dockerfile,
        )


if __name__ == "__main__":
    unittest.main()

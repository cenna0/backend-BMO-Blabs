#!/usr/bin/env python3
"""Static and rendered-Compose checks for the production P9 definition."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILE = ROOT / "ops" / "deploy" / "p9.1-production-compose.yml"
VOICE_COMPOSE_FILE = ROOT / "docker-compose.yml"
RUNBOOK = ROOT / "docs" / "operations" / "PRODUCTION-P9-RUNTIME-DEFINITION.md"
COMPOSE_TEMPLATE = ROOT / "ops" / "deploy" / "p9.1-production.compose.env.example"
BACKEND_TEMPLATE = ROOT / "ops" / "deploy" / "p9.1-production.backend.env.example"
P9_DOCKERFILE = ROOT / "backend" / "Dockerfile.p9.1"
CANDIDATE_COMPOSE_FILE = ROOT / "p9.1-compose.yml"


EXPECTED_MIGRATIONS = [
    "20260804110000_p9_1_foundation",
    "20260804123000_p9_1_integrity_constraints",
    "20260811190000_phase2_application_foundation",
    "20260814120000_whatsapp_conversations",
    "20260814210000_whatsapp_identity_aliases",
    "20260815120000_spotify_phase26_lifecycle",
]

PENDING_FEATURE_MIGRATIONS = [
    "20260818110000_pairing_code_only_enrollment",
]


class P9ProductionPackagingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = tempfile.TemporaryDirectory(prefix="bmo-p9-production-compose-")
        fixture_root = Path(cls.fixture.name)
        cls.data_dir = fixture_root / "postgres-data"
        cls.avatar_dir = fixture_root / "avatars"
        cls.bug_report_dir = fixture_root / "bug-reports"
        cls.data_dir.mkdir()
        cls.avatar_dir.mkdir()
        cls.bug_report_dir.mkdir()

        backend_env = fixture_root / "backend.env"
        backend_env.write_text("PACKAGING_FIXTURE=true\n", encoding="utf-8")

        secret_files = {
            "P9_POSTGRES_PASSWORD_FILE": fixture_root / "postgres-password",
            "P9_WIFI_ENCRYPTION_KEY_FILE": fixture_root / "wifi-key",
            "P9_WHATSAPP_IDENTITY_RESOLVER_TOKEN_FILE": fixture_root / "resolver-token",
            "SPOTIFY_CLIENT_ID_FILE": fixture_root / "spotify-client-id",
            "SPOTIFY_CLIENT_SECRET_FILE": fixture_root / "spotify-client-secret",
            "SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE": fixture_root / "spotify-token-key",
        }
        for path in secret_files.values():
            path.write_text("fixture-only\n", encoding="utf-8")

        environment = os.environ.copy()
        environment.update(
            {
                "P9_PRODUCTION_IMAGE": "bmo-p9.1:spotify-phase26-9819ef7",
                "P9_PRODUCTION_BACKEND_ENV_FILE": str(backend_env),
                "P9_POSTGRES_DATA_DIR": str(cls.data_dir),
                "P9_AVATAR_DATA_DIR": str(cls.avatar_dir),
                "P9_BUG_REPORT_DATA_DIR": str(cls.bug_report_dir),
                **{name: str(path) for name, path in secret_files.items()},
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

    @classmethod
    def tearDownClass(cls) -> None:
        cls.fixture.cleanup()

    def test_backend_is_production_loopback_only(self) -> None:
        backend = self.config["services"]["backend"]
        self.assertEqual(backend["network_mode"], "host")
        self.assertEqual(backend["environment"]["BACKEND_HOST"], "127.0.0.1")
        self.assertEqual(backend["environment"]["BACKEND_PORT"], "3000")
        self.assertNotIn("ports", backend)

    def test_p9_healthcheck_follows_backend_port_with_safe_production_fallback(self) -> None:
        dockerfile = P9_DOCKERFILE.read_text(encoding="utf-8")
        healthcheck = next(
            line for line in dockerfile.splitlines() if line.startswith("HEALTHCHECK ")
        )

        self.assertIn("process.env.BACKEND_PORT", healthcheck)
        self.assertIn("3000", healthcheck)
        self.assertIn("/livez", healthcheck)
        self.assertNotIn("127.0.0.1:3010", healthcheck)

    def test_same_p9_image_contract_supports_production_and_candidate_ports(self) -> None:
        candidate_compose = CANDIDATE_COMPOSE_FILE.read_text(encoding="utf-8")

        self.assertEqual(self.config["services"]["backend"]["environment"]["BACKEND_PORT"], "3000")
        self.assertRegex(candidate_compose, r'(?m)^\s+BACKEND_PORT: "3010"$')

    def test_postgres_is_private_and_persistent(self) -> None:
        postgres = self.config["services"]["postgres"]
        self.assertNotIn("ports", postgres)
        self.assertEqual(postgres["networks"], {"p9_private": None})
        data_mounts = [
            mount for mount in postgres["volumes"]
            if mount["target"] == "/var/lib/postgresql/data"
        ]
        self.assertEqual(len(data_mounts), 1)
        self.assertEqual(data_mounts[0]["source"], str(self.data_dir))
        self.assertFalse(data_mounts[0]["bind"]["create_host_path"])

    def test_only_backend_and_postgres_are_defined(self) -> None:
        self.assertEqual(set(self.config["services"]), {"backend", "postgres"})

    def test_production_secrets_are_read_only_file_mounts(self) -> None:
        backend = self.config["services"]["backend"]
        secret_names = {secret["source"] for secret in backend["secrets"]}
        self.assertEqual(
            secret_names,
            {
                "postgres_password",
                "wifi_encryption_key",
                "whatsapp_identity_resolver_token",
                "spotify_client_id",
                "spotify_client_secret",
                "spotify_token_encryption_key",
            },
        )
        self.assertTrue(all(secret["mode"] == "0400" for secret in backend["secrets"]))

    def test_production_backend_has_persistent_p9_storage(self) -> None:
        backend = self.config["services"]["backend"]
        for target, source in (
            ("/opt/bmo/data/avatars", str(self.avatar_dir)),
            ("/opt/bmo/data/bug-reports", str(self.bug_report_dir)),
        ):
            mounts = [mount for mount in backend["volumes"] if mount["target"] == target]
            self.assertEqual(len(mounts), 1)
            self.assertEqual(mounts[0]["source"], source)
            self.assertFalse(mounts[0]["bind"]["create_host_path"])

    def test_candidate_paths_and_project_names_are_absent(self) -> None:
        rendered = json.dumps(self.config)
        self.assertNotIn("/tmp/bmo-p9-1-validation-20260804", rendered)
        self.assertNotIn("bmo-p9-1", rendered)
        self.assertNotIn("127.0.0.1:3010", rendered)

    def test_production_callback_and_external_dependencies_are_fixed(self) -> None:
        backend = self.config["services"]["backend"]
        environment = backend["environment"]
        self.assertEqual(
            environment["SPOTIFY_CALLBACK_URL"],
            "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback",
        )
        self.assertEqual(environment["HERMES_API_URL"], "http://127.0.0.1:8642")
        self.assertEqual(environment["AUDIO_SERVICE_URL"], "http://127.0.0.1:8001")
        self.assertEqual(environment["WHATSAPP_BRIDGE_URL"], "http://127.0.0.1:3001")
        self.assertEqual(
            environment["WHATSAPP_IDENTITY_RESOLVER_URL"],
            "http://127.0.0.1:3002",
        )

    def test_voice_compose_no_longer_declares_stale_avatar_mount(self) -> None:
        voice_compose = VOICE_COMPOSE_FILE.read_text(encoding="utf-8")
        self.assertNotIn("/opt/bmo/data/avatars", voice_compose)
        self.assertIn("/opt/bmo/temp/audio", voice_compose)

    def test_production_templates_and_runbook_have_required_contracts(self) -> None:
        compose_template = COMPOSE_TEMPLATE.read_text(encoding="utf-8")
        backend_template = BACKEND_TEMPLATE.read_text(encoding="utf-8")
        runbook = RUNBOOK.read_text(encoding="utf-8")
        for text in (compose_template, backend_template, runbook):
            self.assertNotIn("/tmp/bmo-p9-1-validation-20260804", text)
            self.assertNotIn("bmo-p9-1", text)
        self.assertIn("NO_CADDY_CHANGE_REQUIRED", runbook)
        self.assertIn("up -d --no-deps backend", runbook)
        self.assertIn("https://api.personalbmo.web.id/api/v1/integrations/spotify/callback", backend_template)
        self.assertIn("sha256:047301dd3ff0f16812d163455fd4f2fe6f12238435651e4f286cf305cc919241", runbook)

    def test_frozen_sha_contains_production_and_explicitly_pending_migrations(self) -> None:
        migrations = sorted(
            path.name
            for path in (ROOT / "backend" / "prisma" / "migrations").iterdir()
            if path.is_dir()
        )
        self.assertEqual(migrations, sorted(EXPECTED_MIGRATIONS + PENDING_FEATURE_MIGRATIONS))
        manifest = (ROOT / "backend" / "src" / "p9" / "migration-manifest.ts").read_text(encoding="utf-8")
        for migration in EXPECTED_MIGRATIONS + PENDING_FEATURE_MIGRATIONS:
            self.assertIn(f'"{migration}"', manifest)


if __name__ == "__main__":
    unittest.main()

"""Regression fixtures for the stage-aware backend documentation verifier."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
VERIFIER = "scripts/verify-backend-mvp-docs.py"
MERGED_STATE = (
    "P9.1 implementation state: MERGED / NOT DEPLOYED; "
    "PRODUCTION READINESS PACKAGE IN PROGRESS"
)


def copy_fixture() -> Path:
    target = Path(tempfile.mkdtemp(prefix="bmo-doc-verifier-"))
    shutil.copytree(
        REPO,
        target,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns(".git", ".worktrees", "node_modules", "__pycache__"),
    )
    return target


def run_verifier(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", VERIFIER, "--root", str(root)],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )


class StageAwareVerifierFixtures(unittest.TestCase):
    def test_merged_readiness_state_is_accepted(self) -> None:
        result = run_verifier(REPO)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS", result.stdout)

    def test_false_production_state_is_rejected(self) -> None:
        fixture = copy_fixture()
        try:
            status_path = fixture / "docs/backend-mvp/IMPLEMENTATION-STATUS.md"
            status = status_path.read_text(encoding="utf-8")
            status_path.write_text(
                status.replace(MERGED_STATE, "P9.1 implementation state: PRODUCTION DEPLOYED", 1),
                encoding="utf-8",
            )
            result = run_verifier(fixture)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("must not be marked production", result.stdout)
        finally:
            shutil.rmtree(fixture)

    def test_readiness_document_false_deployment_claim_is_rejected(self) -> None:
        fixture = copy_fixture()
        try:
            readiness_path = fixture / "docs/p9/P9.1-PRODUCTION-READINESS.md"
            readiness = readiness_path.read_text(encoding="utf-8")
            readiness_path.write_text(
                readiness + "\nP9.1 is now deployed in production.\n",
                encoding="utf-8",
            )
            result = run_verifier(fixture)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("P9.1 is falsely marked deployed", result.stdout)
        finally:
            shutil.rmtree(fixture)

    def test_p92_implemented_state_is_rejected(self) -> None:
        fixture = copy_fixture()
        try:
            status_path = fixture / "docs/backend-mvp/IMPLEMENTATION-STATUS.md"
            status = status_path.read_text(encoding="utf-8")
            status = status.replace("| PROPOSED; NOT_STARTED |", "| IMPLEMENTED |", 1)
            status_path.write_text(status, encoding="utf-8")
            result = run_verifier(fixture)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("P9.2–P9.6 must remain PROPOSED; NOT_STARTED", result.stdout)
        finally:
            shutil.rmtree(fixture)


if __name__ == "__main__":
    unittest.main()

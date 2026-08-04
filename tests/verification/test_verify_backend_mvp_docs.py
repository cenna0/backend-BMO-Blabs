from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "verify-backend-mvp-docs.py"
FIXTURES = ROOT / "tests" / "fixtures" / "docs-verifier"


class P9PhaseVerifierRegressionTests(unittest.TestCase):
    def run_fixture(self, name: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(prefix="bmo-docs-verifier-") as temporary_root:
            temporary_path = Path(temporary_root)
            shutil.copytree(
                ROOT,
                temporary_path,
                dirs_exist_ok=True,
                ignore=shutil.ignore_patterns(
                    ".git",
                    ".worktrees",
                    ".venv",
                    "node_modules",
                    "__pycache__",
                    ".codex",
                    "dist",
                    "build",
                    "models",
                    "cache",
                    "temp",
                ),
            )
            status_path = temporary_path / "docs" / "backend-mvp" / "IMPLEMENTATION-STATUS.md"
            status_lines = status_path.read_text(encoding="utf-8").splitlines()
            fixture_lines = [line for line in (FIXTURES / name).read_text(encoding="utf-8").splitlines() if line]
            replace_prefixes = (
                "P9 implementation state:",
                "P9.1 implementation state:",
                "P9.2–P9.6 implementation state:",
                "| P9.1 |",
                "| P9.2–P9.6 |",
            )
            for fixture_line in fixture_lines:
                prefix = next((value for value in replace_prefixes if fixture_line.startswith(value)), None)
                if prefix is None:
                    continue
                for index, status_line in enumerate(status_lines):
                    if status_line.startswith(prefix):
                        status_lines[index] = fixture_line
                        break
            status_path.write_text("\n".join(status_lines) + "\n", encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(SCRIPT), "--root", str(temporary_path)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )

    def test_approved_isolated_p9_1_fixture_is_accepted(self) -> None:
        result = self.run_fixture("p9.1-isolated-approved.txt")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_main_pre_p9_state_remains_accepted(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT)],
            cwd=Path("/opt/bmo/app"),
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_p9_1_production_claim_fixture_is_rejected(self) -> None:
        result = self.run_fixture("p9.1-production-deployed.txt")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("P9.1 isolated candidate must not be marked production", result.stdout)

    def test_p9_2_implementation_fixture_is_rejected(self) -> None:
        result = self.run_fixture("p9.2-implemented.txt")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("P9.2–P9.6 must remain PROPOSED; NOT_STARTED", result.stdout)


if __name__ == "__main__":
    unittest.main()

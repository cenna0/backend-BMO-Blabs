import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CANONICAL = "/opt/bmo/secrets/p9.1/backup/backup-encryption-material-v1"
OBSOLETE = "/opt/bmo/config/p9.1/backup-passphrase"
WINDOWS_INCOMING = r"D:\codex\BMO-backups\incoming"
CURRENT_STATE = (
    "SSH V3 VERIFIED / ENCRYPTION MATERIAL PROVISIONED AND PREFLIGHT VALIDATED / "
    "BACKUP ARTIFACT NOT YET CREATED / "
    "WINDOWS TRANSFER NOT YET EXECUTED"
)


class P9EncryptionMaterialPathTests(unittest.TestCase):
    def test_example_uses_only_the_canonical_path(self):
        example = (ROOT / ".env.p9.1.example").read_text(encoding="utf-8")
        self.assertIn(f"P9_BACKUP_PASSPHRASE_FILE={CANONICAL}", example)
        self.assertNotIn(OBSOLETE, example)
        self.assertRegex(example, r"(?i)created manually outside the repository")
        self.assertRegex(example, r"(?i)missing or empty")

    def test_active_backup_instructions_use_canonical_path_and_windows_destination(self):
        active_documents = [
            ROOT / "docs/p9/P9.1-PRODUCTION-RUNBOOKS.md",
            ROOT / "docs/p9/P9.1-PRODUCTION-SECRETS-OPERATOR-GUIDE.md",
            ROOT / "docs/p9/P9.1-PRODUCTION-SECRET-AND-KEY-MANAGEMENT.md",
            ROOT / "docs/p9/P9.1-BACKUP-MONITORING-AND-RESTORE.md",
            ROOT / "docs/p9/P9.1-WINDOWS-OFF-VPS-BACKUP-GUIDE.md",
            ROOT / "docs/NEXT-ACTION.md",
        ]
        combined = "\n".join(path.read_text(encoding="utf-8") for path in active_documents)
        self.assertIn(CANONICAL, combined)
        self.assertIn(WINDOWS_INCOMING, combined)
        self.assertIn(CURRENT_STATE, " ".join(combined.split()))
        self.assertNotIn(OBSOLETE, combined)
        runbook = (ROOT / "docs/p9/P9.1-PRODUCTION-RUNBOOKS.md").read_text(encoding="utf-8")
        self.assertIn("npm run p9:backup:validate-config", runbook)
        self.assertIn("configuration-only preflight", runbook)
        readiness = " ".join(
            (ROOT / "docs/p9/P9.1-PRODUCTION-READINESS.md").read_text(encoding="utf-8").split()
        )
        self.assertRegex(readiness, r"(?i)obsolete migration note.*obsolete and unsupported")

    def test_obsolete_path_is_absent_from_tracked_active_configuration(self):
        example = (ROOT / ".env.p9.1.example").read_text(encoding="utf-8")
        runbook = (ROOT / "docs/p9/P9.1-PRODUCTION-RUNBOOKS.md").read_text(encoding="utf-8")
        self.assertNotIn(OBSOLETE, example)
        self.assertNotIn(OBSOLETE, runbook)

    def test_status_does_not_claim_provisioning_or_artifact_execution(self):
        status_documents = [
            ROOT / "docs/NEXT-ACTION.md",
            ROOT / "docs/p9/P9.1-PRODUCTION-READINESS.md",
            ROOT / "docs/p9/P9.1-PRODUCTION-RUNBOOKS.md",
        ]
        for path in status_documents:
            text = " ".join(path.read_text(encoding="utf-8").split())
            self.assertIn("ENCRYPTION MATERIAL PROVISIONED AND PREFLIGHT VALIDATED", text)
            self.assertIn("BACKUP ARTIFACT NOT YET CREATED", text)
            self.assertIn("WINDOWS TRANSFER NOT YET EXECUTED", text)


if __name__ == "__main__":
    unittest.main()

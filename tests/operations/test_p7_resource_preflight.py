from __future__ import annotations

from contextlib import redirect_stdout
from dataclasses import replace
from io import StringIO
import json
import subprocess
import unittest
from unittest.mock import patch

from ops.deploy.p7_resource_preflight import (
    GIB,
    ContainerMemory,
    PathFilesystem,
    SystemSnapshot,
    TopProcess,
    _docker_inventory,
    _recent_oom_evidence,
    evaluate_snapshot,
    main,
    render_human,
    render_json,
)


def filesystem(
    path: str,
    *,
    free_bytes: int = 40 * GIB,
    device_id: str = "8:1",
) -> PathFilesystem:
    return PathFilesystem(
        requested_path=path,
        probe_path=path,
        device_id=device_id,
        mount_point="/",
        filesystem_type="ext4",
        source="/dev/sda1",
        free_bytes=free_bytes,
    )


def passing_snapshot(**overrides: object) -> SystemSnapshot:
    snapshot = SystemSnapshot(
        total_memory_bytes=8 * GIB,
        available_memory_bytes=6 * GIB,
        swap_total_bytes=0,
        swap_free_bytes=0,
        filesystem_observations=(
            filesystem("/var/lib/docker"),
            filesystem("/opt/bmo/models"),
            filesystem("/opt/bmo/temp/audio"),
        ),
        docker_data_root="/var/lib/docker",
        docker_inventory_available=True,
        unexpected_app_containers=(),
        container_memory_usage=(
            ContainerMemory(
                name="bmo-beszel-hub",
                usage="64MiB / 8GiB",
                percentage="0.8%",
            ),
        ),
        load_average=(0.10, 0.20, 0.30),
        top_memory_consumers=(
            TopProcess(pid=101, name="python", rss_bytes=128 * 1024 * 1024),
        ),
        oom_status="OK",
        oom_signatures=(),
    )
    return replace(snapshot, **overrides)


class ResourceGateTests(unittest.TestCase):
    def test_sufficient_memory_passes(self) -> None:
        report = evaluate_snapshot(passing_snapshot())

        self.assertEqual(report["hard_checks"]["memory"]["status"], "PASS")
        self.assertEqual(report["result"], "PASS")

    def test_low_memory_fails(self) -> None:
        report = evaluate_snapshot(
            passing_snapshot(available_memory_bytes=(5 * GIB) - 1),
        )

        self.assertEqual(report["hard_checks"]["memory"]["status"], "FAIL")
        self.assertEqual(report["result"], "FAIL")

    def test_sufficient_disk_passes(self) -> None:
        report = evaluate_snapshot(passing_snapshot())

        self.assertEqual(report["hard_checks"]["disk"]["status"], "PASS")
        self.assertEqual(report["filesystems"][0]["status"], "PASS")

    def test_low_disk_fails(self) -> None:
        observations = (
            filesystem("/var/lib/docker"),
            filesystem(
                "/opt/bmo/models",
                free_bytes=(20 * GIB) - 1,
                device_id="8:2",
            ),
            filesystem("/opt/bmo/temp/audio"),
        )

        report = evaluate_snapshot(
            passing_snapshot(filesystem_observations=observations),
        )

        self.assertEqual(report["hard_checks"]["disk"]["status"], "FAIL")
        self.assertEqual(report["result"], "FAIL")
        self.assertEqual(
            next(
                item
                for item in report["filesystems"]
                if item["device_id"] == "8:2"
            )["status"],
            "FAIL",
        )

    def test_paths_on_same_filesystem_are_deduplicated(self) -> None:
        report = evaluate_snapshot(passing_snapshot())

        self.assertEqual(len(report["filesystems"]), 1)
        self.assertEqual(
            set(report["filesystems"][0]["paths"]),
            {
                "/var/lib/docker",
                "/opt/bmo/models",
                "/opt/bmo/temp/audio",
            },
        )

    def test_zero_swap_is_recorded_without_failing(self) -> None:
        report = evaluate_snapshot(passing_snapshot())

        self.assertEqual(report["memory"]["swap_total_bytes"], 0)
        self.assertEqual(report["memory"]["swap_free_bytes"], 0)
        self.assertEqual(report["result"], "PASS")

    def test_recent_oom_evidence_fails(self) -> None:
        report = evaluate_snapshot(
            passing_snapshot(
                oom_status="DETECTED",
                oom_signatures=("oom_killer", "killed_process"),
            ),
        )

        self.assertEqual(report["hard_checks"]["recent_oom"]["status"], "FAIL")
        self.assertEqual(report["result"], "FAIL")

    def test_unexpected_application_container_fails(self) -> None:
        report = evaluate_snapshot(
            passing_snapshot(
                unexpected_app_containers=("bmo-production-backend-1",),
            ),
        )

        self.assertEqual(
            report["hard_checks"]["application_containers"]["status"],
            "FAIL",
        )
        self.assertEqual(
            report["docker"]["unexpected_app_containers"],
            ["bmo-production-backend-1"],
        )
        self.assertEqual(report["result"], "FAIL")

    def test_required_diagnostic_unknown_fails_closed(self) -> None:
        report = evaluate_snapshot(
            passing_snapshot(docker_inventory_available=False),
        )

        self.assertEqual(
            report["hard_checks"]["application_containers"]["status"],
            "FAIL",
        )
        self.assertEqual(report["result"], "FAIL")

    def test_optional_diagnostic_access_unavailable_warns(self) -> None:
        report = evaluate_snapshot(
            passing_snapshot(
                swap_total_bytes=None,
                swap_free_bytes=None,
                container_memory_usage=None,
                load_average=None,
                top_memory_consumers=None,
            ),
        )

        self.assertEqual(report["result"], "PASS")
        self.assertGreaterEqual(len(report["warnings"]), 4)

    def test_oom_diagnostic_access_unknown_fails_closed(self) -> None:
        report = evaluate_snapshot(
            passing_snapshot(oom_status="UNKNOWN"),
        )

        self.assertEqual(report["hard_checks"]["recent_oom"]["status"], "UNKNOWN")
        self.assertIn("RECENT_OOM_DIAGNOSTICS_UNKNOWN", report["warnings"])
        self.assertIn("recent_oom", report["failures"])
        self.assertEqual(report["result"], "FAIL")


class OutputTests(unittest.TestCase):
    def test_json_mode_outputs_valid_machine_readable_report(self) -> None:
        output = StringIO()

        with redirect_stdout(output):
            exit_code = main(
                ["--json"],
                collector=lambda: passing_snapshot(),
            )

        payload = json.loads(output.getvalue())
        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["result"], "PASS")
        self.assertEqual(
            payload["thresholds"]["minimum_memory_available_bytes"],
            5 * GIB,
        )
        self.assertEqual(payload["thresholds"]["minimum_free_disk_bytes"], 20 * GIB)

    def test_main_exits_nonzero_when_a_hard_gate_does_not_pass(self) -> None:
        output = StringIO()

        with redirect_stdout(output):
            exit_code = main(
                ["--json"],
                collector=lambda: passing_snapshot(oom_status="UNKNOWN"),
            )

        self.assertEqual(exit_code, 1)
        self.assertEqual(json.loads(output.getvalue())["result"], "FAIL")

    def test_human_and_json_output_redact_secret_like_labels(self) -> None:
        secret = "do-not-print-supersecret"
        report = evaluate_snapshot(
            passing_snapshot(
                container_memory_usage=(
                    ContainerMemory(
                        name=f"api-token={secret}",
                        usage="1MiB / 8GiB",
                        percentage="0.1%",
                    ),
                ),
                top_memory_consumers=(
                    TopProcess(
                        pid=202,
                        name=f"password={secret}",
                        rss_bytes=1024,
                    ),
                ),
            ),
        )

        output = render_human(report) + render_json(report)
        self.assertNotIn(secret, output)
        self.assertIn("[redacted]", output)

    def test_machine_output_contains_required_diagnostics(self) -> None:
        report = evaluate_snapshot(passing_snapshot())

        self.assertIn("total_bytes", report["memory"])
        self.assertIn("available_bytes", report["memory"])
        self.assertIn("swap_total_bytes", report["memory"])
        self.assertIn("docker_data_root", report["docker"])
        self.assertIn("container_memory_usage", report["docker"])
        self.assertIn("load_average", report["diagnostics"])
        self.assertIn("top_memory_consumers", report["diagnostics"])
        self.assertIn("oom", report["diagnostics"])


class CollectorTests(unittest.TestCase):
    @patch("ops.deploy.p7_resource_preflight._run_command")
    def test_docker_inventory_detects_production_app_container(
        self,
        run_command,
    ) -> None:
        run_command.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=(
                "bmo-production-backend-1\t"
                "registry.example/bmo-backend@sha256:abc\t"
                "bmo-production\tbackend\n"
            ),
            stderr="",
        )

        available, unexpected = _docker_inventory()

        self.assertTrue(available)
        self.assertEqual(unexpected, ("bmo-production-backend-1",))

    @patch("ops.deploy.p7_resource_preflight._run_command")
    def test_kernel_oom_output_is_reduced_to_safe_signatures(
        self,
        run_command,
    ) -> None:
        run_command.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=(
                "kernel: worker invoked oom-killer\n"
                "kernel: Out of memory: Killed process 42 (worker)\n"
            ),
            stderr="",
        )

        status, signatures = _recent_oom_evidence()

        self.assertEqual(status, "DETECTED")
        self.assertIn("oom_killer", signatures)
        self.assertIn("killed_process", signatures)


if __name__ == "__main__":
    unittest.main()

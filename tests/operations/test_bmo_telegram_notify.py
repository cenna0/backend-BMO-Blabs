from __future__ import annotations

from contextlib import redirect_stdout
from io import StringIO
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ops.telegram.bmo_telegram_notify import (
    DeliveryError,
    HealthState,
    StateError,
    load_state,
    main,
    run_health_check,
    save_state,
    send_telegram,
    validate_health_payload,
)


class FakeResponse:
    def __init__(self, status: int, payload: bytes) -> None:
        self.status = status
        self._payload = payload

    def read(self, amount: int) -> bytes:
        return self._payload[:amount]

    def close(self) -> None:
        pass


class FakeConnection:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response
        self.requests: list[tuple[str, str, str, dict[str, str]]] = []
        self.closed = False

    def request(
        self,
        method: str,
        path: str,
        body: str,
        headers: dict[str, str],
    ) -> None:
        self.requests.append((method, path, body, headers))

    def getresponse(self) -> FakeResponse:
        return self.response

    def close(self) -> None:
        self.closed = True


def connection_factory(
    status: int = 200,
    payload: bytes = b'{"ok":true}',
):
    connection = FakeConnection(FakeResponse(status, payload))

    def factory(host: str, timeout: int) -> FakeConnection:
        if host != "api.telegram.org" or timeout != 10:
            raise AssertionError("unexpected Telegram connection configuration")
        return connection

    return factory, connection


class TelegramDeliveryTests(unittest.TestCase):
    def test_http_200_and_boolean_ok_true_succeeds(self) -> None:
        factory, connection = connection_factory()

        send_telegram(
            "1:fake-token",
            "123",
            "message",
            connection_factory=factory,
        )

        self.assertEqual(len(connection.requests), 1)
        method, path, body, headers = connection.requests[0]
        self.assertEqual(method, "POST")
        self.assertEqual(path, "/bot1:fake-token/sendMessage")
        self.assertIn("chat_id=123", body)
        self.assertIn("text=message", body)
        self.assertEqual(
            headers["Content-Type"],
            "application/x-www-form-urlencoded",
        )
        self.assertTrue(connection.closed)

    def test_http_error_is_status_only(self) -> None:
        factory, _ = connection_factory(
            status=429,
            payload=b'{"ok":false,"description":"secret-looking response"}',
        )

        with self.assertRaisesRegex(DeliveryError, r"^http_status=429$") as raised:
            send_telegram(
                "1:secret-token",
                "123",
                "message",
                connection_factory=factory,
            )

        error = str(raised.exception)
        self.assertNotIn("secret-token", error)
        self.assertNotIn("api.telegram", error)
        self.assertNotIn("secret-looking", error)

    def test_http_200_ok_false_fails(self) -> None:
        factory, _ = connection_factory(payload=b'{"ok":false}')

        with self.assertRaisesRegex(
            DeliveryError,
            r"^telegram_api_ok_false$",
        ):
            send_telegram(
                "1:fake-token",
                "123",
                "message",
                connection_factory=factory,
            )

    def test_http_200_nonboolean_ok_fails(self) -> None:
        factory, _ = connection_factory(payload=b'{"ok":"true"}')

        with self.assertRaisesRegex(
            DeliveryError,
            r"^telegram_api_ok_false$",
        ):
            send_telegram(
                "1:fake-token",
                "123",
                "message",
                connection_factory=factory,
            )

    def test_http_200_invalid_json_fails(self) -> None:
        factory, _ = connection_factory(payload=b"not-json")

        with self.assertRaisesRegex(
            DeliveryError,
            r"^invalid_json_response$",
        ):
            send_telegram(
                "1:fake-token",
                "123",
                "message",
                connection_factory=factory,
            )

    def test_client_error_uses_exception_class_only(self) -> None:
        def factory(host: str, timeout: int):
            raise TimeoutError(
                "https://api.telegram.org/bot1:secret-token/sendMessage",
            )

        with self.assertRaisesRegex(
            DeliveryError,
            r"^client_error=TimeoutError$",
        ) as raised:
            send_telegram(
                "1:secret-token",
                "123",
                "message",
                connection_factory=factory,
            )

        error = str(raised.exception)
        self.assertNotIn("secret-token", error)
        self.assertNotIn("api.telegram", error)


class HealthPayloadTests(unittest.TestCase):
    def test_expected_payload_is_healthy(self) -> None:
        self.assertTrue(
            validate_health_payload(
                {
                    "status": "ok",
                    "platform": "hermes-agent",
                    "version": "0.19.0",
                },
            ),
        )

    def test_wrong_status_is_unhealthy(self) -> None:
        self.assertFalse(
            validate_health_payload(
                {
                    "status": "error",
                    "platform": "hermes-agent",
                    "version": "0.19.0",
                },
            ),
        )

    def test_wrong_platform_is_unhealthy(self) -> None:
        self.assertFalse(
            validate_health_payload(
                {
                    "status": "ok",
                    "platform": "other",
                    "version": "0.19.0",
                },
            ),
        )

    def test_wrong_version_is_unhealthy(self) -> None:
        self.assertFalse(
            validate_health_payload(
                {
                    "status": "ok",
                    "platform": "hermes-agent",
                    "version": "0.20.0",
                },
            ),
        )


class StateMachineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.state_path = Path(self.tempdir.name) / "state.json"
        self.messages: list[str] = []

    def notify(self, message: str) -> None:
        self.messages.append(message)

    def run_check(self, healthy: bool) -> HealthState:
        return run_health_check(
            self.state_path,
            health_probe=lambda: healthy,
            notify=self.notify,
        )

    def test_healthy_clean_state_has_no_notification(self) -> None:
        state = self.run_check(healthy=True)

        self.assertEqual(state, HealthState())
        self.assertEqual(self.messages, [])
        self.assertEqual(load_state(self.state_path), HealthState())

    def test_third_consecutive_failure_sends_one_down(self) -> None:
        first = self.run_check(healthy=False)
        second = self.run_check(healthy=False)
        third = self.run_check(healthy=False)

        self.assertEqual(first, HealthState(failures=1))
        self.assertEqual(second, HealthState(failures=2))
        self.assertEqual(
            third,
            HealthState(failures=3, down_alerted=True),
        )
        self.assertEqual(len(self.messages), 1)
        self.assertIn("DOWN", self.messages[0])

    def test_repeated_failure_after_down_does_not_repeat(self) -> None:
        save_state(
            self.state_path,
            HealthState(failures=3, down_alerted=True),
        )

        state = self.run_check(healthy=False)

        self.assertEqual(state, HealthState(failures=3, down_alerted=True))
        self.assertEqual(self.messages, [])

    def test_healthy_after_down_sends_one_recovery(self) -> None:
        save_state(
            self.state_path,
            HealthState(failures=3, down_alerted=True),
        )

        first = self.run_check(healthy=True)
        second = self.run_check(healthy=True)

        self.assertEqual(first, HealthState())
        self.assertEqual(second, HealthState())
        self.assertEqual(len(self.messages), 1)
        self.assertIn("RECOVERED", self.messages[0])

    def test_down_delivery_failure_is_retried(self) -> None:
        save_state(self.state_path, HealthState(failures=2))

        def fail_notify(message: str) -> None:
            raise DeliveryError("client_error=TimeoutError")

        with self.assertRaisesRegex(
            DeliveryError,
            r"^client_error=TimeoutError$",
        ):
            run_health_check(
                self.state_path,
                health_probe=lambda: False,
                notify=fail_notify,
            )

        self.assertEqual(
            load_state(self.state_path),
            HealthState(failures=3, down_alerted=False),
        )

        state = self.run_check(healthy=False)
        self.assertEqual(state, HealthState(failures=3, down_alerted=True))
        self.assertEqual(len(self.messages), 1)

    def test_recovery_delivery_failure_is_retried(self) -> None:
        save_state(
            self.state_path,
            HealthState(failures=3, down_alerted=True),
        )

        def fail_notify(message: str) -> None:
            raise DeliveryError("http_status=503")

        with self.assertRaisesRegex(DeliveryError, r"^http_status=503$"):
            run_health_check(
                self.state_path,
                health_probe=lambda: True,
                notify=fail_notify,
            )

        self.assertEqual(
            load_state(self.state_path),
            HealthState(failures=0, down_alerted=True),
        )

        state = self.run_check(healthy=True)
        self.assertEqual(state, HealthState())
        self.assertEqual(len(self.messages), 1)

    def test_malformed_state_fails_without_notification(self) -> None:
        self.state_path.write_text(
            json.dumps({"failures": "three", "down_alerted": False}),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(StateError, r"^invalid_state$"):
            self.run_check(healthy=True)

        self.assertEqual(self.messages, [])

    def test_state_file_is_mode_0600(self) -> None:
        save_state(self.state_path, HealthState(failures=1))

        self.assertEqual(self.state_path.stat().st_mode & 0o777, 0o600)


class CommandTests(unittest.TestCase):
    def test_static_test_uses_exact_group_test_label(self) -> None:
        with tempfile.TemporaryDirectory() as credentials_directory:
            credentials = Path(credentials_directory)
            (credentials / "telegram-bot-token").write_text(
                "1:fake-token\n",
                encoding="utf-8",
            )
            (credentials / "telegram-chat-id").write_text(
                "-123\n",
                encoding="utf-8",
            )
            output = StringIO()
            with (
                patch.dict(
                    os.environ,
                    {"CREDENTIALS_DIRECTORY": credentials_directory},
                ),
                patch(
                    "ops.telegram.bmo_telegram_notify.send_telegram",
                ) as sender,
                redirect_stdout(output),
            ):
                result = main(["test"])

        self.assertEqual(result, 0)
        sender.assert_called_once()
        self.assertEqual(
            sender.call_args.args[2].splitlines()[0],
            "[P6 HERMES GROUP TEST]",
        )
        self.assertIn(
            "telegram_delivery=success label=direct_test",
            output.getvalue(),
        )


if __name__ == "__main__":
    unittest.main()

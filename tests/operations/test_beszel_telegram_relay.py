from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import http.client
from io import StringIO
from threading import Thread
import unittest

from ops.telegram.beszel_telegram_relay import make_handler
from ops.telegram.bmo_telegram_notify import DeliveryError
from http.server import ThreadingHTTPServer


class RelayHttpTests(unittest.TestCase):
    def start_server(self, sender):
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            make_handler(
                "1:secret-token",
                "123",
                telegram_sender=sender,
            ),
        )
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)
        return server

    def request(
        self,
        server: ThreadingHTTPServer,
        method: str,
        path: str,
        body: bytes | None = None,
    ) -> tuple[int, bytes]:
        connection = http.client.HTTPConnection(
            "127.0.0.1",
            server.server_port,
            timeout=2,
        )
        self.addCleanup(connection.close)
        connection.request(
            method,
            path,
            body=body,
            headers={"Content-Type": "text/plain"},
        )
        response = connection.getresponse()
        return response.status, response.read()

    def test_post_returns_204_after_strict_sender_success(self) -> None:
        calls: list[tuple[str, str, str]] = []

        def sender(token: str, chat_id: str, message: str) -> None:
            calls.append((token, chat_id, message))

        server = self.start_server(sender)

        status, body = self.request(
            server,
            "POST",
            "/notify",
            b"[P6 BESZEL PATH TEST]\nTest Alert",
        )

        self.assertEqual(status, 204)
        self.assertEqual(body, b"")
        self.assertEqual(
            calls,
            [
                (
                    "1:secret-token",
                    "123",
                    "[BMO BESZEL]\n"
                    "[P6 BESZEL PATH TEST]\nTest Alert",
                ),
            ],
        )

    def test_exact_beszel_builtin_test_payload_uses_group_test_label(
        self,
    ) -> None:
        messages: list[str] = []

        def sender(token: str, chat_id: str, message: str) -> None:
            messages.append(message)

        server = self.start_server(sender)
        status, body = self.request(
            server,
            "POST",
            "/notify",
            b"This is a notification from Beszel.",
        )

        self.assertEqual((status, body), (204, b""))
        self.assertEqual(
            messages,
            [
                "[BMO BESZEL GROUP TEST]\n"
                "This is a notification from Beszel.",
            ],
        )

    def test_non_test_payloads_are_never_relabelled(self) -> None:
        messages: list[str] = []

        def sender(token: str, chat_id: str, message: str) -> None:
            messages.append(message)

        server = self.start_server(sender)
        near_matches = (
            "This is a notification from Beszel",
            "This is a notification from Beszel. ",
            " This is a notification from Beszel.",
            "This is a notification from Beszel.\n",
            "this is a notification from Beszel.",
            "This is a notification from Beszel. extra",
            "CPU averaged 91% for the previous 10 minutes.",
        )

        for payload in near_matches:
            with self.subTest(payload=payload):
                messages.clear()
                status, body = self.request(
                    server,
                    "POST",
                    "/notify",
                    payload.encode("utf-8"),
                )

                self.assertEqual((status, body), (204, b""))
                self.assertEqual(
                    messages,
                    [f"[BMO BESZEL]\n{payload}"],
                )
                self.assertNotIn(
                    "[BMO BESZEL GROUP TEST]",
                    messages[0],
                )

    def test_delivery_error_returns_sanitized_502(self) -> None:
        def sender(token: str, chat_id: str, message: str) -> None:
            raise DeliveryError("telegram_api_ok_false")

        server = self.start_server(sender)
        output = StringIO()

        with redirect_stdout(output), redirect_stderr(output):
            status, body = self.request(
                server,
                "POST",
                "/notify",
                b"message",
            )

        self.assertEqual(status, 502)
        self.assertEqual(body, b"delivery_failed\n")
        logged = output.getvalue()
        self.assertIn("telegram_api_ok_false", logged)
        self.assertNotIn("secret-token", logged)
        self.assertNotIn("api.telegram", logged)

    def test_unsafe_delivery_error_text_is_not_logged(self) -> None:
        def sender(token: str, chat_id: str, message: str) -> None:
            raise DeliveryError(
                "https://api.telegram.org/bot1:secret-token/sendMessage",
            )

        server = self.start_server(sender)
        output = StringIO()

        with redirect_stdout(output), redirect_stderr(output):
            status, body = self.request(
                server,
                "POST",
                "/notify",
                b"message",
            )

        self.assertEqual(status, 502)
        self.assertEqual(body, b"delivery_failed\n")
        logged = output.getvalue()
        self.assertIn("reason=delivery_error", logged)
        self.assertNotIn("secret-token", logged)
        self.assertNotIn("api.telegram", logged)

    def test_unexpected_error_logs_exception_class_only(self) -> None:
        def sender(token: str, chat_id: str, message: str) -> None:
            raise TimeoutError(
                "https://api.telegram.org/bot1:secret-token/sendMessage",
            )

        server = self.start_server(sender)
        output = StringIO()

        with redirect_stdout(output), redirect_stderr(output):
            status, body = self.request(
                server,
                "POST",
                "/notify",
                b"message",
            )

        self.assertEqual(status, 502)
        self.assertEqual(body, b"delivery_failed\n")
        logged = output.getvalue()
        self.assertIn("internal_error=TimeoutError", logged)
        self.assertNotIn("secret-token", logged)
        self.assertNotIn("api.telegram", logged)

    def test_health_is_local_and_does_not_send(self) -> None:
        def sender(token: str, chat_id: str, message: str) -> None:
            self.fail("health request must not send Telegram")

        server = self.start_server(sender)

        status, body = self.request(server, "GET", "/health")

        self.assertEqual(status, 204)
        self.assertEqual(body, b"")

    def test_unknown_path_is_rejected_without_access_log(self) -> None:
        def sender(token: str, chat_id: str, message: str) -> None:
            self.fail("unknown path must not send Telegram")

        server = self.start_server(sender)
        output = StringIO()

        with redirect_stdout(output), redirect_stderr(output):
            status, body = self.request(
                server,
                "POST",
                "/bot1:secret-token/sendMessage",
                b"message",
            )

        self.assertEqual(status, 404)
        self.assertEqual(body, b"not_found\n")
        self.assertEqual(output.getvalue(), "")


if __name__ == "__main__":
    unittest.main()

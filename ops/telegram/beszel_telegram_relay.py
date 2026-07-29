#!/usr/bin/env python3
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import sys
from typing import Callable

try:
    from .bmo_telegram_notify import (
        DeliveryError,
        send_telegram,
        validate_runtime_credentials,
    )
except ImportError:
    from bmo_telegram_notify import (
        DeliveryError,
        send_telegram,
        validate_runtime_credentials,
    )


BIND_HOST = "0.0.0.0"
BIND_PORT = 8787
TOKEN_FILE = Path("/run/secrets/telegram-bot-token")
CHAT_FILE = Path("/run/secrets/telegram-chat-id")
MAX_MESSAGE_BYTES = 65_536
BESZEL_BUILT_IN_TEST_PAYLOAD = "This is a notification from Beszel."
BESZEL_ALERT_LABEL = "[BMO BESZEL]"
BESZEL_GROUP_TEST_LABEL = "[BMO BESZEL GROUP TEST]"
SAFE_DELIVERY_ERROR = re.compile(
    r"^(?:"
    r"http_status=[0-9]{3}|"
    r"invalid_json_response|"
    r"telegram_api_ok_false|"
    r"response_too_large|"
    r"client_error=[A-Za-z][A-Za-z0-9_]*"
    r")$",
)


class RelayConfigError(RuntimeError):
    pass


def read_secret(path: Path, label: str) -> str:
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        raise RelayConfigError(f"credential_unreadable={label}") from None
    if not value or "\n" in value or "\r" in value:
        raise RelayConfigError(f"credential_invalid={label}")
    return value


def safe_delivery_reason(error: DeliveryError) -> str:
    reason = str(error)
    if SAFE_DELIVERY_ERROR.fullmatch(reason):
        return reason
    return "delivery_error"


def format_telegram_message(message: str) -> str:
    label = (
        BESZEL_GROUP_TEST_LABEL
        if message == BESZEL_BUILT_IN_TEST_PAYLOAD
        else BESZEL_ALERT_LABEL
    )
    return f"{label}\n{message}"


def make_handler(
    token: str,
    chat_id: str,
    *,
    telegram_sender: Callable[[str, str, str], None] = send_telegram,
) -> type[BaseHTTPRequestHandler]:
    class RelayHandler(BaseHTTPRequestHandler):
        server_version = "bmo-telegram-relay"
        sys_version = ""

        def log_message(self, format: str, *args: object) -> None:
            pass

        def send_fixed(self, status: int, body: bytes = b"") -> None:
            self.send_response(status)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/health":
                self.send_fixed(204)
                return
            self.send_fixed(404, b"not_found\n")

        def do_POST(self) -> None:
            if self.path != "/notify":
                self.send_fixed(404, b"not_found\n")
                return

            raw_length = self.headers.get("Content-Length")
            try:
                length = int(raw_length) if raw_length is not None else -1
            except ValueError:
                length = -1
            if length < 1:
                self.send_fixed(400, b"invalid_request\n")
                return
            if length > MAX_MESSAGE_BYTES:
                self.send_fixed(413, b"request_too_large\n")
                return

            body = self.rfile.read(length)
            try:
                message = body.decode("utf-8")
            except UnicodeDecodeError:
                self.send_fixed(400, b"invalid_request\n")
                return
            if not message.strip():
                self.send_fixed(400, b"invalid_request\n")
                return

            try:
                telegram_sender(
                    token,
                    chat_id,
                    format_telegram_message(message),
                )
            except DeliveryError as error:
                print(
                    "beszel_relay_delivery=failed "
                    f"reason={safe_delivery_reason(error)}",
                    file=sys.stderr,
                    flush=True,
                )
                self.send_fixed(502, b"delivery_failed\n")
                return
            except Exception as error:
                print(
                    "beszel_relay_delivery=failed "
                    f"reason=internal_error={type(error).__name__}",
                    file=sys.stderr,
                    flush=True,
                )
                self.send_fixed(502, b"delivery_failed\n")
                return

            print("beszel_relay_delivery=success", flush=True)
            self.send_fixed(204)

    return RelayHandler


def main() -> int:
    try:
        token = read_secret(TOKEN_FILE, "telegram-bot-token")
        chat_id = read_secret(CHAT_FILE, "telegram-chat-id")
        try:
            validate_runtime_credentials(token, chat_id)
        except Exception as error:
            raise RelayConfigError(str(error)) from None
        server = ThreadingHTTPServer(
            (BIND_HOST, BIND_PORT),
            make_handler(token, chat_id),
        )
        server.daemon_threads = True
        print("beszel_telegram_relay=ready", flush=True)
        server.serve_forever()
        return 0
    except KeyboardInterrupt:
        return 0
    except RelayConfigError as error:
        print(f"beszel_relay_error={error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(
            f"beszel_relay_error=internal_error={type(error).__name__}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

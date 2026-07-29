#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import http.client
import json
import os
from pathlib import Path
import re
import socket
import tempfile
from typing import Callable, Sequence
import urllib.parse
import urllib.request


TELEGRAM_HOST = "api.telegram.org"
TELEGRAM_TIMEOUT_SECONDS = 10
HERMES_HEALTH_URL = "http://127.0.0.1:8642/health"
HERMES_VERSION = "0.19.0"
MAX_RESPONSE_BYTES = 65_536
TOKEN_PATTERN = re.compile(r"^[0-9]+:[A-Za-z0-9_-]+$")
CHAT_PATTERN = re.compile(r"^-?[0-9]+$")


class DeliveryError(RuntimeError):
    pass


class CredentialError(RuntimeError):
    pass


class StateError(RuntimeError):
    pass


@dataclass(frozen=True)
class HealthState:
    failures: int = 0
    down_alerted: bool = False


def send_telegram(
    token: str,
    chat_id: str,
    message: str,
    *,
    connection_factory: Callable[..., http.client.HTTPSConnection] = (
        http.client.HTTPSConnection
    ),
) -> None:
    connection = None
    response = None
    try:
        connection = connection_factory(
            TELEGRAM_HOST,
            timeout=TELEGRAM_TIMEOUT_SECONDS,
        )
        body = urllib.parse.urlencode(
            {
                "chat_id": chat_id,
                "text": message,
                "disable_web_page_preview": "true",
            },
        )
        connection.request(
            "POST",
            f"/bot{token}/sendMessage",
            body,
            {"Content-Type": "application/x-www-form-urlencoded"},
        )
        response = connection.getresponse()
        response_body = response.read(MAX_RESPONSE_BYTES + 1)
        if not 200 <= response.status < 300:
            raise DeliveryError(f"http_status={response.status}")
        if len(response_body) > MAX_RESPONSE_BYTES:
            raise DeliveryError("response_too_large")
        try:
            payload = json.loads(response_body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise DeliveryError("invalid_json_response") from None
        if not isinstance(payload, dict) or payload.get("ok") is not True:
            raise DeliveryError("telegram_api_ok_false")
    except DeliveryError:
        raise
    except Exception as error:
        raise DeliveryError(
            f"client_error={type(error).__name__}",
        ) from None
    finally:
        if response is not None:
            try:
                response.close()
            except Exception:
                pass
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass


def load_credential(name: str) -> str:
    credentials_directory = os.environ.get("CREDENTIALS_DIRECTORY")
    if not credentials_directory:
        raise CredentialError("credentials_directory_missing")
    path = Path(credentials_directory) / name
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        raise CredentialError(f"credential_unreadable={name}") from None
    if not value or "\n" in value or "\r" in value:
        raise CredentialError(f"credential_invalid={name}")
    return value


def validate_health_payload(payload: object) -> bool:
    return (
        isinstance(payload, dict)
        and payload.get("status") == "ok"
        and payload.get("platform") == "hermes-agent"
        and payload.get("version") == HERMES_VERSION
    )


def check_hermes_health(
    opener: Callable = urllib.request.urlopen,
) -> bool:
    request = urllib.request.Request(
        HERMES_HEALTH_URL,
        headers={"Accept": "application/json"},
    )
    try:
        with opener(request, timeout=5) as response:
            status = response.getcode()
            if not 200 <= status < 300:
                return False
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                return False
        return validate_health_payload(json.loads(body))
    except Exception:
        return False


def load_state(path: Path) -> HealthState:
    if not path.exists():
        return HealthState()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        raise StateError("invalid_state") from None
    if not isinstance(payload, dict) or set(payload) != {
        "failures",
        "down_alerted",
    }:
        raise StateError("invalid_state")
    failures = payload["failures"]
    down_alerted = payload["down_alerted"]
    if (
        isinstance(failures, bool)
        or not isinstance(failures, int)
        or not 0 <= failures <= 3
        or not isinstance(down_alerted, bool)
    ):
        raise StateError("invalid_state")
    return HealthState(
        failures=failures,
        down_alerted=down_alerted,
    )


def save_state(path: Path, state: HealthState) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".state.",
        dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(asdict(state), stream, separators=(",", ":"), sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
    except Exception:
        try:
            os.close(descriptor)
        except OSError:
            pass
        temporary_path.unlink(missing_ok=True)
        raise


def run_health_check(
    state_path: Path,
    health_probe: Callable[[], bool],
    notify: Callable[[str], None],
) -> HealthState:
    state = load_state(state_path)
    healthy = health_probe()
    hostname = socket.gethostname()

    if healthy:
        pending = HealthState(failures=0, down_alerted=state.down_alerted)
        save_state(state_path, pending)
        if state.down_alerted:
            notify(
                f"[P6 HERMES HEALTH] RECOVERED\n"
                f"Host: {hostname}\n"
                "Hermes health is healthy again.",
            )
            pending = HealthState()
            save_state(state_path, pending)
        return pending

    failures = min(3, state.failures + 1)
    if state.down_alerted:
        pending = HealthState(failures=3, down_alerted=True)
        save_state(state_path, pending)
        return pending

    pending = HealthState(failures=failures, down_alerted=False)
    save_state(state_path, pending)
    if failures >= 3:
        notify(
            f"[P6 HERMES HEALTH] DOWN\n"
            f"Host: {hostname}\n"
            "Hermes failed three consecutive health checks.",
        )
        pending = HealthState(failures=3, down_alerted=True)
        save_state(state_path, pending)
    return pending


def validate_runtime_credentials(token: str, chat_id: str) -> None:
    if not TOKEN_PATTERN.fullmatch(token):
        raise CredentialError("credential_invalid=telegram-bot-token")
    if not CHAT_PATTERN.fullmatch(chat_id):
        raise CredentialError("credential_invalid=telegram-chat-id")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("check", "test"))
    arguments = parser.parse_args(argv)

    try:
        token = load_credential("telegram-bot-token")
        chat_id = load_credential("telegram-chat-id")
        validate_runtime_credentials(token, chat_id)

        def notify(message: str) -> None:
            send_telegram(token, chat_id, message)

        if arguments.action == "test":
            notify(
                "[P6 HERMES GROUP TEST]\n"
                f"Host: {socket.gethostname()}\n"
                "Strict delivery validation requires HTTP success and ok=true.",
            )
            print("telegram_delivery=success label=direct_test")
            return 0

        state_directory = os.environ.get("STATE_DIRECTORY")
        if not state_directory:
            raise StateError("state_directory_missing")
        state = run_health_check(
            Path(state_directory) / "state.json",
            health_probe=check_hermes_health,
            notify=notify,
        )
        print(
            "hermes_health_check=complete "
            f"failures={state.failures} "
            f"down_alerted={str(state.down_alerted).lower()}",
        )
        return 0
    except (CredentialError, DeliveryError, StateError) as error:
        print(f"notification_error={error}", file=os.sys.stderr)
        return 1
    except Exception as error:
        print(
            f"notification_error=internal_error={type(error).__name__}",
            file=os.sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sqlite3
import sys
import time
from typing import Callable
import urllib.error
import urllib.parse
import urllib.request

BESZEL_ORIGIN = "http://127.0.0.1:8090"
BESZEL_DATABASE = "/opt/bmo/data/beszel/hub/data.db"
RELAY_WEBHOOK = (
    "generic://telegram-relay:8787/notify?disabletls=yes"
)
API_TIMEOUT_SECONDS = 10
MAX_RESPONSE_BYTES = 65_536


class BeszelConfigError(RuntimeError):
    pass


def base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def encode_static_jwt(claims: dict, signing_key: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    encoded_header = base64url(
        json.dumps(
            header,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8"),
    )
    encoded_claims = base64url(
        json.dumps(
            claims,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8"),
    )
    signing_input = f"{encoded_header}.{encoded_claims}".encode("ascii")
    signature = hmac.new(
        signing_key.encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    return f"{encoded_header}.{encoded_claims}.{base64url(signature)}"


def mint_static_user_token(
    database: sqlite3.Connection,
    now: int,
) -> tuple[str, str, dict]:
    users = database.execute(
        "select id, tokenKey from users where verified = 1 order by id",
    ).fetchall()
    if len(users) != 1:
        raise BeszelConfigError("unexpected_user_count")
    user_id, token_key = users[0]

    collection_rows = database.execute(
        "select id, options from _collections where name = 'users'",
    ).fetchall()
    if len(collection_rows) != 1:
        raise BeszelConfigError("unexpected_collection_count")
    collection_id, raw_options = collection_rows[0]

    settings_rows = database.execute(
        "select id, settings from user_settings where user = ?",
        (user_id,),
    ).fetchall()
    if len(settings_rows) != 1:
        raise BeszelConfigError("unexpected_settings_count")
    settings_id, raw_settings = settings_rows[0]

    try:
        options = json.loads(raw_options)
        settings = json.loads(raw_settings)
        auth_secret = options["authToken"]["secret"]
    except (KeyError, TypeError, json.JSONDecodeError):
        raise BeszelConfigError("invalid_user_settings") from None
    if (
        not isinstance(settings, dict)
        or not isinstance(token_key, str)
        or not token_key
        or not isinstance(auth_secret, str)
        or not auth_secret
    ):
        raise BeszelConfigError("invalid_user_settings")

    claims = {
        "collectionId": collection_id,
        "exp": now + 300,
        "id": user_id,
        "refreshable": False,
        "type": "auth",
    }
    token = encode_static_jwt(claims, token_key + auth_secret)
    return token, settings_id, settings


def merge_webhook(
    settings: dict,
) -> tuple[dict, str]:
    if not isinstance(settings, dict):
        raise BeszelConfigError("invalid_user_settings")
    existing = settings.get("webhooks", [])
    if not isinstance(existing, list) or not all(
        isinstance(item, str) for item in existing
    ):
        raise BeszelConfigError("invalid_user_settings")
    preserved = [
        item
        for item in existing
        if (
            urllib.parse.urlsplit(item).scheme.lower() != "telegram"
            and item != RELAY_WEBHOOK
        )
    ]
    merged = dict(settings)
    merged["webhooks"] = [*preserved, RELAY_WEBHOOK]
    return merged, RELAY_WEBHOOK


def api_json(
    method: str,
    path: str,
    body: dict,
    auth_token: str,
    *,
    opener: Callable = urllib.request.urlopen,
) -> dict:
    if not path.startswith("/") or "://" in path:
        raise BeszelConfigError("invalid_api_path")
    request = urllib.request.Request(
        BESZEL_ORIGIN + path,
        data=json.dumps(
            body,
            separators=(",", ":"),
        ).encode("utf-8"),
        headers={
            "Authorization": auth_token,
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with opener(request, timeout=API_TIMEOUT_SECONDS) as response:
            response_body = response.read(MAX_RESPONSE_BYTES + 1)
            status = response.status
        if not 200 <= status < 300:
            raise BeszelConfigError(f"http_status={status}")
        if len(response_body) > MAX_RESPONSE_BYTES:
            raise BeszelConfigError("response_too_large")
        try:
            payload = json.loads(response_body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise BeszelConfigError("invalid_json_response") from None
        if not isinstance(payload, dict):
            raise BeszelConfigError("invalid_json_response")
        return payload
    except urllib.error.HTTPError as error:
        raise BeszelConfigError(f"http_status={error.code}") from None
    except BeszelConfigError:
        raise
    except Exception as error:
        raise BeszelConfigError(
            f"client_error={type(error).__name__}",
        ) from None


def validate_test_response(payload: dict) -> None:
    if not isinstance(payload, dict) or payload.get("err") is not False:
        raise BeszelConfigError("beszel_test_rejected")


def configure_and_test() -> None:
    database_uri = f"file:{BESZEL_DATABASE}?mode=ro"
    try:
        with sqlite3.connect(database_uri, uri=True) as database:
            auth_token, settings_id, settings = mint_static_user_token(
                database,
                int(time.time()),
            )
    except BeszelConfigError:
        raise
    except sqlite3.Error:
        raise BeszelConfigError("database_error") from None

    merged_settings, webhook = merge_webhook(settings)
    encoded_settings_id = urllib.parse.quote(settings_id, safe="")
    updated = api_json(
        "PATCH",
        f"/api/collections/user_settings/records/{encoded_settings_id}",
        {"settings": merged_settings},
        auth_token,
    )
    updated_settings = updated.get("settings")
    if not isinstance(updated_settings, dict):
        raise BeszelConfigError("settings_update_unverified")
    updated_webhooks = updated_settings.get("webhooks")
    if (
        not isinstance(updated_webhooks, list)
        or updated_webhooks.count(webhook) != 1
    ):
        raise BeszelConfigError("settings_update_unverified")

    test_response = api_json(
        "POST",
        "/api/beszel/test-notification",
        {"url": webhook},
        auth_token,
    )
    validate_test_response(test_response)
    print("beszel_webhook_count=1")
    print("beszel_test_accepted=true")


def main() -> int:
    try:
        configure_and_test()
        return 0
    except BeszelConfigError as error:
        print(f"beszel_notification_error={error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(
            f"beszel_notification_error=internal_error={type(error).__name__}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import base64
import json
import sqlite3
import unittest

from ops.telegram.configure_beszel_telegram import (
    BeszelConfigError,
    RELAY_WEBHOOK,
    api_json,
    merge_webhook,
    mint_static_user_token,
    validate_test_response,
)


def decode_jwt_payload(token: str) -> dict:
    encoded = token.split(".")[1]
    encoded += "=" * (-len(encoded) % 4)
    return json.loads(base64.urlsafe_b64decode(encoded))


class FakeApiResponse:
    def __init__(self, status: int, payload: bytes) -> None:
        self.status = status
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        pass

    def read(self, amount: int) -> bytes:
        return self._payload[:amount]


class BeszelTokenTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.executescript(
            """
            create table _collections (
                id text primary key,
                name text not null,
                options text not null
            );
            create table users (
                id text primary key,
                tokenKey text not null,
                verified integer not null
            );
            create table user_settings (
                id text primary key,
                user text not null,
                settings text not null
            );
            """,
        )
        self.db.execute(
            "insert into _collections (id, name, options) values (?, ?, ?)",
            (
                "users-collection",
                "users",
                json.dumps(
                    {
                        "authToken": {
                            "duration": 604800,
                            "secret": "fake-collection-secret",
                        },
                    },
                ),
            ),
        )
        self.db.execute(
            "insert into users (id, tokenKey, verified) values (?, ?, ?)",
            ("user-record", "fake-token-key", 1),
        )
        self.db.execute(
            "insert into user_settings (id, user, settings) values (?, ?, ?)",
            (
                "settings-record",
                "user-record",
                json.dumps(
                    {
                        "chartTime": "1h",
                        "emails": ["operator@example.invalid"],
                    },
                ),
            ),
        )
        self.db.commit()

    def test_static_user_jwt_has_expected_claims_and_five_minute_expiry(self) -> None:
        now = 1_785_000_000

        token, settings_id, settings = mint_static_user_token(self.db, now)
        claims = decode_jwt_payload(token)

        self.assertEqual(
            claims,
            {
                "collectionId": "users-collection",
                "exp": now + 300,
                "id": "user-record",
                "refreshable": False,
                "type": "auth",
            },
        )
        self.assertEqual(settings_id, "settings-record")
        self.assertEqual(settings["chartTime"], "1h")
        self.assertEqual(
            settings["emails"],
            ["operator@example.invalid"],
        )

    def test_multiple_verified_users_are_rejected(self) -> None:
        self.db.execute(
            "insert into users (id, tokenKey, verified) values (?, ?, ?)",
            ("second-user", "second-key", 1),
        )
        self.db.commit()

        with self.assertRaisesRegex(
            BeszelConfigError,
            r"^unexpected_user_count$",
        ):
            mint_static_user_token(self.db, 1_785_000_000)

    def test_malformed_settings_are_rejected(self) -> None:
        self.db.execute(
            "update user_settings set settings = ?",
            ("not-json",),
        )
        self.db.commit()

        with self.assertRaisesRegex(
            BeszelConfigError,
            r"^invalid_user_settings$",
        ):
            mint_static_user_token(self.db, 1_785_000_000)


class WebhookMergeTests(unittest.TestCase):
    def test_preserves_emails_and_nontelegram_webhooks(self) -> None:
        merged, webhook = merge_webhook(
            {
                "emails": ["operator@example.invalid"],
                "webhooks": ["generic://example.invalid"],
            },
        )

        self.assertEqual(
            merged["emails"],
            ["operator@example.invalid"],
        )
        self.assertEqual(
            merged["webhooks"],
            ["generic://example.invalid", webhook],
        )
        self.assertEqual(webhook, RELAY_WEBHOOK)
        self.assertNotIn("fake-token", webhook)

    def test_replaces_existing_managed_webhooks_once(self) -> None:
        merged, webhook = merge_webhook(
            {
                "webhooks": [
                    "telegram://1:old@telegram?chats=456",
                    "generic://example.invalid",
                    "telegram://2:old@telegram?chats=789",
                    RELAY_WEBHOOK,
                ],
            },
        )

        self.assertEqual(
            merged["webhooks"],
            ["generic://example.invalid", webhook],
        )

    def test_invalid_webhooks_shape_is_rejected(self) -> None:
        with self.assertRaisesRegex(
            BeszelConfigError,
            r"^invalid_user_settings$",
        ):
            merge_webhook(
                {"webhooks": "not-a-list"},
            )


class BeszelApiTests(unittest.TestCase):
    def test_http_success_returns_json(self) -> None:
        def opener(request, timeout: int):
            self.assertEqual(
                request.full_url,
                "http://127.0.0.1:8090/example",
            )
            self.assertEqual(timeout, 10)
            self.assertEqual(
                request.headers["Authorization"],
                "fake-auth-token",
            )
            return FakeApiResponse(200, b'{"err":false}')

        payload = api_json(
            "POST",
            "/example",
            {"safe": True},
            "fake-auth-token",
            opener=opener,
        )

        self.assertEqual(payload, {"err": False})

    def test_http_error_is_status_only(self) -> None:
        def opener(request, timeout: int):
            return FakeApiResponse(
                500,
                b'{"url":"telegram://1:secret-token@telegram"}',
            )

        with self.assertRaisesRegex(
            BeszelConfigError,
            r"^http_status=500$",
        ) as raised:
            api_json(
                "POST",
                "/example",
                {"url": "telegram://1:secret-token@telegram"},
                "fake-auth-token",
                opener=opener,
            )

        error = str(raised.exception)
        self.assertNotIn("secret-token", error)
        self.assertNotIn("telegram://", error)

    def test_client_error_uses_exception_class_only(self) -> None:
        def opener(request, timeout: int):
            raise TimeoutError(
                "http://127.0.0.1:8090/example?token=secret",
            )

        with self.assertRaisesRegex(
            BeszelConfigError,
            r"^client_error=TimeoutError$",
        ) as raised:
            api_json(
                "POST",
                "/example",
                {"safe": True},
                "fake-auth-token",
                opener=opener,
            )

        self.assertNotIn("token=secret", str(raised.exception))

    def test_invalid_json_is_rejected(self) -> None:
        def opener(request, timeout: int):
            return FakeApiResponse(200, b"not-json")

        with self.assertRaisesRegex(
            BeszelConfigError,
            r"^invalid_json_response$",
        ):
            api_json(
                "POST",
                "/example",
                {"safe": True},
                "fake-auth-token",
                opener=opener,
            )

    def test_test_endpoint_requires_err_false(self) -> None:
        validate_test_response({"err": False})

        with self.assertRaisesRegex(
            BeszelConfigError,
            r"^beszel_test_rejected$",
        ):
            validate_test_response({"err": "delivery failed"})


if __name__ == "__main__":
    unittest.main()

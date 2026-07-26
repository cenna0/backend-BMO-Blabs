# BMO MVP Hardware Handoff Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a concise, canonical, and verifiable handoff pack that lets the hardware team implement ESP32-S3 firmware against the existing BMO voice MVP without interpreting backend internals.

**Architecture:** Keep `docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md` as protocol source of truth. Add four operational documents under `docs/hardware-handoff/`: quickstart, staging configuration template, firmware checklist, and physical-device acceptance matrix. Add a Python standard-library verifier that prevents contract drift, broken local links, missing test IDs, deployment ambiguity, and committed device tokens.

**Tech Stack:** Markdown, Python 3 standard library, `unittest`, existing Node.js/TypeScript backend regression suite.

---

## File Map

| File | Responsibility |
|---|---|
| `docs/hardware-handoff/START-HERE.md` | Ten-minute entry point, ownership, happy path, canonical quick reference |
| `docs/hardware-handoff/STAGING-CONFIG.template.md` | Non-secret deployment handoff with explicit unavailable state |
| `docs/hardware-handoff/FIRMWARE-CHECKLIST.md` | Implementation checklist mapped to contract and observable pass conditions |
| `docs/hardware-handoff/ACCEPTANCE-TESTS.md` | Physical ESP32 test cases, evidence schema, final verification gate |
| `scripts/verify_hardware_handoff.py` | Static validation for completeness, drift, links, IDs, and secret safety |
| `scripts/tests/test_verify_hardware_handoff.py` | Unit and repository-level tests for the verifier |
| `scripts/tests/__init__.py` | Makes verifier tests directly runnable through `unittest` |

Canonical contract, backend source, and existing backend tests remain unchanged unless verification exposes a real contradiction.

### Task 1: Add handoff verifier foundation

**Files:**
- Create: `scripts/verify_hardware_handoff.py`
- Create: `scripts/tests/__init__.py`
- Create: `scripts/tests/test_verify_hardware_handoff.py`

- [ ] **Step 1: Write failing verifier tests**

Create `scripts/tests/__init__.py`:

```python
"""Repository verification tests."""
```

Create `scripts/tests/test_verify_hardware_handoff.py`:

```python
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.verify_hardware_handoff import (
    EXPECTED_FILES,
    extract_local_links,
    find_token_violations,
    verify,
)


class HardwareHandoffVerifierTests(unittest.TestCase):
    def test_empty_repository_reports_all_handoff_files(self) -> None:
        with TemporaryDirectory() as directory:
            errors = verify(Path(directory))

        for name in EXPECTED_FILES:
            self.assertIn(f"missing docs/hardware-handoff/{name}", errors)

    def test_local_link_extraction_ignores_external_and_anchor_links(self) -> None:
        text = (
            "[local](../hardware-contract/contract.md)\n"
            "[section](#state-machine)\n"
            "[external](https://example.com)\n"
        )

        self.assertEqual(extract_local_links(text), ["../hardware-contract/contract.md"])

    def test_token_sentinel_is_allowed_but_secret_value_is_rejected(self) -> None:
        self.assertEqual(
            find_token_violations("DEVICE_TOKEN: PROVIDED_OUT_OF_BAND"),
            [],
        )
        self.assertEqual(
            find_token_violations("DEVICE_TOKEN: super-secret-value"),
            ["DEVICE_TOKEN assignment contains a committed value"],
        )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests and confirm expected failure**

Run:

```powershell
python -m unittest scripts.tests.test_verify_hardware_handoff -v
```

Expected: `ERROR` with `ModuleNotFoundError: No module named 'scripts.verify_hardware_handoff'`.

- [ ] **Step 3: Implement verifier**

Create `scripts/verify_hardware_handoff.py`:

```python
#!/usr/bin/env python3
from pathlib import Path
import re
import sys


EXPECTED_FILES = (
    "START-HERE.md",
    "STAGING-CONFIG.template.md",
    "FIRMWARE-CHECKLIST.md",
    "ACCEPTANCE-TESTS.md",
)

REQUIRED_BY_FILE = {
    "START-HERE.md": (
        "BMO MVP Hardware Handoff",
        "PRE-STAGING",
        "POST /api/v1/voice",
        "WS /ws",
        "GET /audio/:audioId.mp3",
        "HTTP `202`",
        "`display_status`",
        "`request_id`",
        "backend/scripts/fake-esp32.ts",
        "../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md",
    ),
    "STAGING-CONFIG.template.md": (
        "DEPLOYMENT_STATUS: NOT_AVAILABLE",
        "HTTP_BASE_URL: NOT_AVAILABLE",
        "WEBSOCKET_URL: NOT_AVAILABLE",
        "DEVICE_TOKEN: PROVIDED_OUT_OF_BAND",
        "SMOKE_TEST_STATUS: NOT_RUN",
    ),
    "FIRMWARE-CHECKLIST.md": (
        "Alamat backend",
        "Device ID & Token",
        "Format WAV",
        "Endpoint upload",
        "WebSocket Event",
        "Event yang ESP32 harus kirim",
        "Response upload",
        "Audio download",
        "Display / Ekspresi",
        "Error Code",
        "Timeout",
        "Retry",
        "Testing",
        "PCM signed 16-bit little-endian",
        "WEBSOCKET_NOT_CONNECTED",
        "REQUEST_ID_CONFLICT",
        "MISSING_REQUIRED_HEADER",
        "INVALID_REQUEST_ID",
        "UNSUPPORTED_AUDIO_TYPE",
        "AUDIO_TOO_LARGE",
        "INVALID_AUDIO_FORMAT",
        "NO_SPEECH",
        "STT_FAILED",
        "HERMES_FAILED",
        "TTS_FAILED",
        "PIPELINE_TIMEOUT",
        "INTERNAL_ERROR",
        "audio_playback_failed",
    ),
    "ACCEPTANCE-TESTS.md": (
        "HARDWARE INTEGRATION VERIFIED",
        "physical ESP32",
        "PASS",
        "FAIL",
        "BLOCKED",
        "firmware build ID",
        "request ID",
    ),
}

FORBIDDEN_MARKERS = (
    "TBD",
    "TODO",
    "<IP_VPS>",
    "<DOMAIN_API_BMO>",
    "WEBSOCKET_NOT_READY",
)

TOKEN_ASSIGNMENT = re.compile(
    r"(?im)^\s*(DEVICE_TOKEN|device_token)\s*[:=]\s*(\S.*?)\s*$"
)
MARKDOWN_LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
ALLOWED_TOKEN_VALUES = {"PROVIDED_OUT_OF_BAND", "NOT_COMMITTED"}


def extract_local_links(text: str) -> list[str]:
    links = []
    for target in MARKDOWN_LINK.findall(text):
        target = target.strip()
        if target.startswith(("#", "http://", "https://", "mailto:")):
            continue
        links.append(target.split("#", 1)[0])
    return links


def find_token_violations(text: str) -> list[str]:
    violations = []
    for match in TOKEN_ASSIGNMENT.finditer(text):
        if match.group(2).strip() not in ALLOWED_TOKEN_VALUES:
            violations.append("DEVICE_TOKEN assignment contains a committed value")
    return violations


def verify(root: Path) -> list[str]:
    handoff = root / "docs" / "hardware-handoff"
    errors: list[str] = []
    texts: dict[str, str] = {}

    for name in EXPECTED_FILES:
        path = handoff / name
        if not path.is_file():
            errors.append(f"missing docs/hardware-handoff/{name}")
            continue
        texts[name] = path.read_text(encoding="utf-8")

    for name, required_values in REQUIRED_BY_FILE.items():
        text = texts.get(name)
        if text is None:
            continue
        for value in required_values:
            if value not in text:
                errors.append(f"{name}: missing required value: {value}")

    all_text = "\n".join(texts.values())
    for marker in FORBIDDEN_MARKERS:
        if marker in all_text:
            errors.append(f"forbidden unresolved marker: {marker}")
    errors.extend(find_token_violations(all_text))

    acceptance = texts.get("ACCEPTANCE-TESTS.md", "")
    expected_ids = {f"HW-AT-{number:03d}" for number in range(1, 26)}
    actual_id_list = re.findall(r"\bHW-AT-\d{3}\b", acceptance)
    actual_ids = set(actual_id_list)
    missing = sorted(expected_ids - actual_ids)
    extra = sorted(actual_ids - expected_ids)
    if missing:
        errors.append(f"acceptance IDs missing: {', '.join(missing)}")
    if extra:
        errors.append(f"acceptance IDs unexpected: {', '.join(extra)}")
    for acceptance_id in sorted(expected_ids):
        count = actual_id_list.count(acceptance_id)
        if count != 1:
            errors.append(f"acceptance ID {acceptance_id} count={count}, expected 1")

    for name, text in texts.items():
        source = handoff / name
        for target in extract_local_links(text):
            resolved = (source.parent / target).resolve()
            if not resolved.is_file():
                errors.append(f"{name}: broken local link: {target}")

    return errors


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    errors = verify(root)
    if errors:
        print("FAIL")
        for error in errors:
            print(f"- {error}")
        return 1
    print("PASS")
    print("Verified hardware handoff files, canonical markers, acceptance IDs, links, and token safety.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run focused unit tests**

Run:

```powershell
python -m unittest scripts.tests.test_verify_hardware_handoff -v
```

Expected: `Ran 3 tests` and `OK`.

- [ ] **Step 5: Commit verifier foundation**

```powershell
git add scripts/verify_hardware_handoff.py scripts/tests/__init__.py scripts/tests/test_verify_hardware_handoff.py
git commit -m "test: add hardware handoff verifier"
```

### Task 2: Create ESP32 start-here guide

**Files:**
- Create: `docs/hardware-handoff/START-HERE.md`

- [ ] **Step 1: Confirm entry document is absent**

Run:

```powershell
Test-Path docs/hardware-handoff/START-HERE.md
```

Expected: `False`.

- [ ] **Step 2: Write entry guide with exact section contract**

Create `docs/hardware-handoff/START-HERE.md` with these headings and facts:

````markdown
# BMO MVP Hardware Handoff

**Audience:** Tim hardware/firmware ESP32-S3
**Integration status:** PRE-STAGING
**Protocol authority:** [Hardware ↔ Backend Contract v1.0.5](../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md)

## 1. Mulai dari sini

Backend voice MVP sudah tersedia dan diuji lokal. Tim hardware dapat mulai membuat state machine, WAV encoder, WebSocket client, HTTP upload, MP3 playback, display state, retry, dan recovery. Endpoint staging belum tersedia; pakai status dan nilai non-secret dari [staging config](STAGING-CONFIG.template.md).

Jangan menebak alamat atau token. `DEVICE_TOKEN` diberikan melalui kanal privat setelah staging smoke test lulus.

## 2. Pembagian tanggung jawab

| Firmware ESP32-S3 | Backend |
|---|---|
| Wi-Fi, wake word, recording, WAV | WebSocket auth dan request state |
| UUID v4 dan raw WAV upload | STT → Hermes → TTS |
| MP3 download/decoder/playback | Temporary MP3 URL |
| Display dan audio error lokal | `thinking`, `audio_ready`, `request_failed` |
| Retry, reconnect, dedupe | Idempotency dan reconnect state sync |

## 3. Kontrak cepat

| Fungsi | Kontrak |
|---|---|
| WebSocket | `WS /ws` |
| Upload | `POST /api/v1/voice` |
| Download | `GET /audio/:audioId.mp3` |
| Input | raw `audio/wav`; bukan multipart/base64/WebSocket chunk |
| WAV | PCM signed 16-bit little-endian, 16 kHz, mono |
| Stop recording | diam 2,5 detik atau hard limit 60 detik |
| Output | MP3 mono 24 kHz/96 kbps baseline |
| Display | `idle`, `thinking`, `speaking`, `error` |

## 4. Happy path

1. Connect Wi-Fi.
2. Open WebSocket `/ws`.
3. Kirim `authenticate` maksimal 5 detik setelah socket open.
4. Tunggu `authenticated`.
5. Wake word dan recording berjalan lokal; display tetap `idle`.
6. Buat UUID v4 untuk rekaman baru.
7. `POST /api/v1/voice` dengan raw WAV dan header canonical.
8. Korelasikan HTTP `202` dan `display_status` memakai `request_id`; urutan keduanya tidak dijamin.
9. Saat `audio_ready`, ambil MP3 dari `audio_url`.
10. Buffer dan decode progresif.
11. Ubah display ke `speaking` ketika playback benar-benar mulai.
12. Kirim `audio_playback_done` atau `audio_playback_failed`.
13. Bersihkan request lokal dan kembali `idle`.

## 5. Header upload

| Header | Nilai |
|---|---|
| `X-Device-Id` | device ID dari staging config |
| `X-Device-Token` | token privat |
| `X-Request-Id` | UUID v4; sama untuk retry rekaman sama |
| `Content-Type` | `audio/wav` |
| `Content-Length` | ukuran byte WAV aktual |

## 6. Event canonical

ESP32 → backend:

- `authenticate`
- `audio_playback_done`
- `audio_playback_failed`

Backend → ESP32:

- `authenticated`
- `authentication_failed`
- `connection_replaced`
- `display_status`
- `audio_ready`
- `request_failed`

Tidak ada `audio_chunk`, `wake_word_detected`, `audio_ready_received`, atau display `listening` pada MVP.

## 7. Payload minimum

Auth:

```json
{
  "event": "authenticate",
  "device_id": "bmo-001",
  "device_token": "PROVIDED_OUT_OF_BAND"
}
```

Upload accepted:

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing"
}
```

Thinking:

```json
{
  "event": "display_status",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "thinking"
}
```

Audio ready:

```json
{
  "event": "audio_ready",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "audio_url": "URL_FROM_BACKEND_EVENT",
  "format": "mp3",
  "expires_in_seconds": 300
}
```

Playback completion:

```json
{
  "event": "audio_playback_done",
  "request_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Playback failure:

```json
{
  "event": "audio_playback_failed",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "reason": "DOWNLOAD_FAILED"
}
```

Backend failure:

```json
{
  "event": "request_failed",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "code": "NO_SPEECH",
  "recoverable": true
}
```

## 8. Urutan implementasi

1. Config dan Wi-Fi.
2. WebSocket auth/reconnect.
3. WAV encoder dan stop recording.
4. UUID/request state dan HTTP upload.
5. Event parser dan display `thinking`.
6. MP3 download/decoder/playback.
7. Completion/failure events.
8. Retry, dedupe, reconnect recovery.
9. Jalankan [firmware checklist](FIRMWARE-CHECKLIST.md).
10. Jalankan [physical-device acceptance tests](ACCEPTANCE-TESTS.md).

## 9. Reference behavior

[Fake ESP32 reference](../../backend/scripts/fake-esp32.ts) adalah reference behavior executable sisi software. File tersebut bukan firmware ESP32 dan bukan pengganti physical-device verification.

## 10. Definition of done

Integrasi baru berstatus `HARDWARE INTEGRATION VERIFIED` setelah physical ESP32 lulus acceptance matrix, termasuk progressive playback, display transition, retry, reconnect, dedupe, dan request berikutnya setelah setiap terminal path.
````

- [ ] **Step 3: Run verifier and confirm only remaining pack gaps**

Run:

```powershell
python scripts/verify_hardware_handoff.py
```

Expected: `FAIL`; `START-HERE.md` must not appear as missing. Remaining errors must concern the three documents not created yet or their dependent acceptance IDs/links.

- [ ] **Step 4: Commit entry guide**

```powershell
git add docs/hardware-handoff/START-HERE.md
git commit -m "docs: add ESP32 hardware start guide"
```

### Task 3: Create safe staging configuration template

**Files:**
- Create: `docs/hardware-handoff/STAGING-CONFIG.template.md`

- [ ] **Step 1: Confirm staging template is absent**

Run:

```powershell
Test-Path docs/hardware-handoff/STAGING-CONFIG.template.md
```

Expected: `False`.

- [ ] **Step 2: Write exact pre-deployment template**

Create `docs/hardware-handoff/STAGING-CONFIG.template.md`:

````markdown
# BMO MVP Staging Configuration

## Current handoff values

```text
DEPLOYMENT_STATUS: NOT_AVAILABLE
ENVIRONMENT_NAME: staging
HTTP_BASE_URL: NOT_AVAILABLE
WEBSOCKET_URL: NOT_AVAILABLE
HEALTH_URL: NOT_AVAILABLE
DEVICE_ID: bmo-001
DEVICE_TOKEN: PROVIDED_OUT_OF_BAND
MAX_AUDIO_BYTES: 3145728
MAX_RECORDING_SECONDS: 60
WAV_SAMPLE_RATE_HZ: 16000
WAV_BITS_PER_SAMPLE: 16
WAV_CHANNELS: 1
UPLOAD_TIMEOUT_SECONDS: 90
MP3_TTL_SECONDS: 300
SMOKE_TEST_STATUS: NOT_RUN
VALID_FROM: NOT_AVAILABLE
BACKEND_OWNER: B-Labs software team
```

## Activation gate

Tim backend mengubah `DEPLOYMENT_STATUS` menjadi `AVAILABLE` hanya setelah:

- health endpoint dapat dijangkau dari network hardware;
- WebSocket auth sukses;
- raw WAV upload menghasilkan HTTP `202`;
- `audio_ready` diterima;
- MP3 dapat diunduh;
- credential staging dikirim melalui kanal privat.

## Security

- Token asli tidak disimpan di Git.
- Token tidak dikirim melalui URL/query string.
- Token tidak dicetak ke serial log.
- Firmware menyimpan token di konfigurasi non-public.
- Token staging dirotasi setelah TLS aktif.

## Runtime mapping

Saat deployment aktif:

- upload URL = `HTTP_BASE_URL` + `/api/v1/voice`;
- WebSocket URL = nilai `WEBSOCKET_URL`;
- health check = nilai `HEALTH_URL`;
- `audio_url` selalu dipakai langsung dari event `audio_ready`.

## Owner update record

Setiap aktivasi/perubahan mencatat environment, tanggal berlaku, backend owner, smoke-test result, dan alasan perubahan. Secret tetap berada di kanal privat.
````

- [ ] **Step 3: Verify token safety**

Run:

```powershell
python -c "from pathlib import Path; from scripts.verify_hardware_handoff import find_token_violations; p=Path('docs/hardware-handoff/STAGING-CONFIG.template.md'); print(find_token_violations(p.read_text(encoding='utf-8')))"
```

Expected: `[]`.

- [ ] **Step 4: Run partial pack verification**

Run:

```powershell
python scripts/verify_hardware_handoff.py
```

Expected: `FAIL`; staging config must no longer be reported missing. Failures remain for firmware checklist, acceptance tests, dependent links, and acceptance IDs.

- [ ] **Step 5: Commit staging template**

```powershell
git add docs/hardware-handoff/STAGING-CONFIG.template.md
git commit -m "docs: add safe hardware staging template"
```

### Task 4: Create firmware implementation checklist

**Files:**
- Create: `docs/hardware-handoff/FIRMWARE-CHECKLIST.md`

- [ ] **Step 1: Confirm firmware checklist is absent**

Run:

```powershell
Test-Path docs/hardware-handoff/FIRMWARE-CHECKLIST.md
```

Expected: `False`.

- [ ] **Step 2: Add original-needs coverage map**

Start `docs/hardware-handoff/FIRMWARE-CHECKLIST.md` with:

```markdown
# BMO MVP Firmware Checklist

**Authority:** [Hardware ↔ Backend Contract v1.0.5](../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md)

## Coverage kebutuhan awal

| # | Kebutuhan | Lokasi kerja |
|---:|---|---|
| 1 | Alamat backend | staging config + Config |
| 2 | Device ID & Token | staging config + Config |
| 3 | Format WAV | Recording/WAV |
| 4 | Endpoint upload | HTTP Upload |
| 5 | WebSocket Event | WebSocket/Event Parser |
| 6 | Event yang ESP32 harus kirim | WebSocket/Event Sender |
| 7 | Response upload | HTTP Upload |
| 8 | Audio download | MP3 Playback |
| 9 | Display / Ekspresi | Display State |
| 10 | Error Code | Error/Recovery |
| 11 | Timeout | Timeout |
| 12 | Retry | Retry/Deduplication |
| 13 | Testing | Acceptance Readiness |

Tambahan wajib: Wi-Fi readiness, security, lifecycle, heartbeat, request persistence, race handling, firmware build ID, logging aman, dan evidence.

Setiap checkbox memiliki link contract dan kondisi pass yang dapat diamati.
```

- [ ] **Step 3: Add exact module checklists**

Continue the same file with these sections and checks:

```markdown
## Config

- [ ] Device memakai URL dari staging config, bukan hardcode alamat dokumentasi.
  - Contract: §4.1, §6.2.
  - Pass: serial log menampilkan environment dan host tanpa token.
- [ ] Device ID tersedia saat boot.
  - Contract: §3.
  - Pass: auth payload memakai device ID staging.
- [ ] Token disimpan non-public dan tidak masuk URL/log.
  - Contract: §3, §4.2.
  - Pass: log dan firmware artifact scan tidak mengandung token plaintext yang dibagikan.
- [ ] Firmware mencetak semantic version/build ID.
  - Pass: setiap acceptance evidence dapat dikorelasikan ke build.

## Wi-Fi dan network

- [ ] Firmware menunggu network ready sebelum WebSocket/auth/upload.
  - Pass: boot tanpa Wi-Fi tidak membuat upload liar; reconnect dimulai setelah network pulih.
- [ ] DNS/TLS error dibedakan dari auth/protocol error.
  - Pass: log mempunyai kategori network tanpa membocorkan credential.

## WebSocket connection dan auth

- [ ] Connect ke `WS /ws`.
  - Contract: §4.1.
  - Pass: socket open ke URL staging.
- [ ] Kirim `authenticate` maksimal 5 detik setelah open.
  - Contract: §4.2.
  - Pass: menerima `authenticated`.
- [ ] Tangani close `4001`, `4003`, `4008`.
  - Contract: §4.2.
  - Pass: tindakan auth-required, invalid-credential, dan auth-timeout dapat dibedakan.
- [ ] Balas native ping dengan pong.
  - Contract: §4.4.
  - Pass: koneksi idle bertahan; dua missed pong memicu reconnect.
- [ ] Reconnect memakai 1s → 2s → 4s → 8s → 16s → maksimum 30s.
  - Contract: §4.4.
  - Pass: log timestamp membuktikan backoff; sukses auth mereset delay ke 1s.
- [ ] Tangani `connection_replaced`.
  - Contract: §4.3.
  - Pass: koneksi lama berhenti mengirim request.

## Recording dan WAV

- [ ] Wake word/recording lokal tidak menambah display `listening`.
  - Contract: §5.1.
  - Pass: display tetap `idle` saat recording.
- [ ] Stop pada kondisi pertama: diam 2,5 detik atau hard limit 60 detik.
  - Contract: §5.2.
  - Pass: evidence durasi menunjukkan kedua boundary.
- [ ] Encode WAV RIFF, PCM signed 16-bit little-endian, 16 kHz, mono.
  - Contract: §5.3.
  - Pass: WAV metadata cocok dan backend menerima file.
- [ ] Tolak lokal rekaman yang melewati 3 MB baseline.
  - Contract: §5.3.
  - Pass: payload oversized tidak dikirim.

## Request state dan UUID

- [ ] Rekaman baru membuat UUID v4 baru.
  - Contract: §6.1.
  - Pass: `X-Request-Id` valid UUID v4.
- [ ] Retry rekaman sama mempertahankan WAV byte-identical dan request ID sama.
  - Contract: §6.5.
  - Pass: backend membalas duplicate tanpa pipeline kedua.
- [ ] Simpan `current_request_id`, request state, playback state, upload attempt, download attempt, dan reconnect delay.
  - Contract: §7.1, §9.
  - Pass: reconnect tidak menggandakan upload/playback.
- [ ] Satu request aktif per device.
  - Contract: §10.
  - Pass: wake word baru diabaikan saat `thinking`/`speaking`.

## HTTP upload

- [ ] Kirim `POST /api/v1/voice` dengan raw WAV body.
  - Contract: §6.2–§6.3.
  - Pass: bukan multipart, base64, JSON audio, atau WebSocket chunk.
- [ ] Kirim `X-Device-Id`, `X-Device-Token`, `X-Request-Id`, `Content-Type: audio/wav`, dan byte-accurate `Content-Length`.
  - Contract: §6.3.
  - Pass: HTTP `202` + `status: processing`.
- [ ] Korelasikan HTTP dan WebSocket berdasarkan `request_id`.
  - Contract: §6.4.
  - Pass: kedua urutan `202`/`display_status` menghasilkan state sama.
- [ ] Upload timeout baseline 90 detik.
  - Contract: §6.7.
  - Pass: timeout masuk retry matrix, bukan request ID baru.
- [ ] Maksimal 3 total attempts: awal, 1 detik, retry, 2 detik, retry final.
  - Contract: §6.5.
  - Pass: attempt log dan request ID konsisten.

## Response upload dan recovery

- [ ] Kenali HTTP/error canonical:
  - `400 MISSING_REQUIRED_HEADER`
  - `400 INVALID_REQUEST_ID`
  - `401 INVALID_DEVICE_CREDENTIALS`
  - `409 WEBSOCKET_NOT_CONNECTED`
  - `409 DEVICE_BUSY`
  - `409 REQUEST_ID_CONFLICT`
  - `413 AUDIO_TOO_LARGE`
  - `415 UNSUPPORTED_AUDIO_TYPE`
  - `422 INVALID_AUDIO_FORMAT`
- [ ] `202 processing`: tunggu event request sama.
- [ ] `200 duplicate processing`: tetap tunggu.
- [ ] `200 duplicate audio_ready`: konsumsi event tanpa playback kedua.
- [ ] `200 duplicate completed`: bersihkan state, kembali `idle`.
- [ ] `200 duplicate failed/expired`: error lokal, kembali `idle`.
- [ ] `409 WEBSOCKET_NOT_CONNECTED`: reconnect/auth lalu retry request sama.
- [ ] `409 DEVICE_BUSY`: tunggu request aktif; jangan buat request baru.
- [ ] `409 REQUEST_ID_CONFLICT`: hentikan payload; ID baru hanya untuk rekaman baru.
- [ ] `400/413/415/422`: jangan retry byte sama.
- [ ] `401 INVALID_DEVICE_CREDENTIALS`: hentikan retry sampai config diperbaiki.
- [ ] `5xx`/network putus: retry sesuai total-attempt limit.
  - Contract semua item: §6.5–§6.7.
  - Pass: acceptance test terkait menunjukkan tindakan exact.

## WebSocket event parser/sender

- [ ] Parse `authenticated`, termasuk `backend_state` dan `active_request_id`.
- [ ] Parse `authentication_failed`.
- [ ] Parse `connection_replaced`.
- [ ] Parse `display_status`.
- [ ] Parse `audio_ready`.
- [ ] Parse `request_failed`.
- [ ] Kirim hanya `authenticate`, `audio_playback_done`, `audio_playback_failed`.
- [ ] Unknown/invalid event dicatat aman tanpa crash.
  - Contract: §4, §7–§9, §14.
  - Pass: parser test dan physical reconnect test lulus.

## MP3 download dan playback

- [ ] Gunakan `audio_url` langsung; jangan membentuk nama file dari request ID.
- [ ] Terima `audio/mpeg` dan validasi `Content-Length`.
- [ ] Decoder diuji terhadap MP3 mono 24 kHz/96 kbps baseline.
- [ ] Buffer awal 32–64 KB atau 0,5–1 detik sebelum playback.
- [ ] Lanjutkan download progresif saat decoder berjalan.
- [ ] Ubah display ke `speaking` tepat ketika playback mulai.
- [ ] Download gagal: buang buffer, tunggu 1 detik, retry sekali dari awal.
- [ ] HTTP `410 AUDIO_EXPIRED`: jangan retry URL; tampilkan error lokal.
- [ ] Kirim `audio_playback_done` setelah playback selesai.
- [ ] Kirim `audio_playback_failed` dengan `DOWNLOAD_FAILED`, `DECODE_FAILED`, atau `PLAYBACK_FAILED`.
  - Contract: §7.
  - Pass: output audible, tidak terpotong, tidak diputar dua kali.

## Display dan error lokal

- [ ] Implementasi hanya `idle`, `thinking`, `speaking`, `error`.
- [ ] Backend hanya mengendalikan `thinking`; firmware mengendalikan state lain.
- [ ] `request_failed` selalu dikorelasikan ke current request ID.
- [ ] Kenali semua code `request_failed`: `NO_SPEECH`, `INVALID_AUDIO`, `STT_FAILED`, `HERMES_FAILED`, `TTS_FAILED`, `AUDIO_EXPIRED`, `PIPELINE_TIMEOUT`, `INTERNAL_ERROR`.
- [ ] `NO_SPEECH` memakai pesan error lokal noise.
- [ ] Error recoverable lain memakai pesan error lokal umum.
- [ ] Setelah error audio/ekspresi selesai, kembali `idle`.
  - Contract: §5, §8, §12.
  - Pass: display/audio evidence cocok untuk happy path dan error path.

## Reconnect dan dedupe

- [ ] `backend_state=idle`: batalkan request lokal yang sudah hilang dari memory backend.
- [ ] `backend_state=thinking`: pertahankan request dan tunggu resend.
- [ ] `backend_state=audio_ready`: pakai resend jika belum download/play.
- [ ] Duplicate `audio_ready` saat downloading/playing diabaikan.
- [ ] `done_pending_send` mengirim ulang `audio_playback_done` setelah reconnect.
- [ ] `failed_pending_send` mengirim ulang `audio_playback_failed` setelah reconnect.
  - Contract: §7.1, §9.
  - Pass: tidak ada upload/playback ganda dan device kembali siap.

## Logging aman

- [ ] Log timestamp, firmware build ID, non-secret device ID, request ID, state transition, HTTP status/error code, WebSocket event/close code, attempt, dan audio byte count.
- [ ] Jangan log token, full auth payload, atau secret URL query.
  - Pass: evidence cukup untuk diagnosis dan secret scan bersih.

## Acceptance readiness

- [ ] Staging config berstatus `AVAILABLE` dan smoke test lulus.
- [ ] Token diterima melalui kanal privat.
- [ ] Seluruh checkbox relevan selesai.
- [ ] Jalankan `HW-AT-001` sampai `HW-AT-025`.
- [ ] Setiap `FAIL` mempunyai defect evidence; setiap `BLOCKED` mempunyai dependency.
- [ ] Status final hanya `HARDWARE INTEGRATION VERIFIED` setelah physical ESP32 memenuhi gate.
```

- [ ] **Step 4: Run partial verifier**

Run:

```powershell
python scripts/verify_hardware_handoff.py
```

Expected: `FAIL`; checklist is no longer missing and has no missing required values. Remaining failures concern acceptance tests, acceptance IDs, or its link.

- [ ] **Step 5: Commit checklist**

```powershell
git add docs/hardware-handoff/FIRMWARE-CHECKLIST.md
git commit -m "docs: add ESP32 firmware integration checklist"
```

### Task 5: Create physical ESP32 acceptance matrix

**Files:**
- Create: `docs/hardware-handoff/ACCEPTANCE-TESTS.md`

- [ ] **Step 1: Confirm acceptance document is absent**

Run:

```powershell
Test-Path docs/hardware-handoff/ACCEPTANCE-TESTS.md
```

Expected: `False`.

- [ ] **Step 2: Add execution rules and evidence schema**

Start `docs/hardware-handoff/ACCEPTANCE-TESTS.md`:

````markdown
# BMO MVP Physical ESP32 Acceptance Tests

**Target:** physical ESP32-S3 running candidate firmware
**Authority:** [Hardware ↔ Backend Contract v1.0.5](../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md)
**Config:** [Staging configuration](STAGING-CONFIG.template.md)

## Status rules

- `PASS`: expected device, HTTP, WebSocket, audio, display, and cleanup behavior observed.
- `FAIL`: behavior contradicts expected result; defect evidence attached.
- `BLOCKED`: named external dependency prevents execution; test is not counted as pass.

Fake ESP32 proves backend behavior only. Final `HARDWARE INTEGRATION VERIFIED` requires physical ESP32 evidence.

## Evidence header

Record once per run:

```text
date/time:
environment:
firmware semantic version:
firmware build ID:
device ID:
hardware revision:
mic:
speaker/amplifier:
display:
network:
tester:
```

For every case record:

```text
status: PASS | FAIL | BLOCKED
request ID:
HTTP status/body:
WebSocket event/close code:
display transition:
WAV/MP3 metadata and byte count:
retry/reconnect timestamps:
audible result:
log attachment:
defect/dependency:
```
````

- [ ] **Step 3: Add exact 25-case matrix**

Continue the same file:

```markdown
## Acceptance matrix

| ID | Scenario | Procedure | Expected result | Evidence | Owner |
|---|---|---|---|---|---|
| HW-AT-001 | WebSocket auth success | Connect `/ws`; send valid `authenticate` within 5s | `authenticated`, correct device ID, valid backend state | event + timestamps | Joint |
| HW-AT-002 | Invalid credential | Authenticate with deliberately invalid test token | `authentication_failed`; close `4003`; no upload retry loop | event + close code | Joint |
| HW-AT-003 | Auth timeout | Open socket; send no auth for 5s | close `4008`; reconnect backoff begins | timestamps + close code | HW |
| HW-AT-004 | Valid WAV upload | Auth; record canonical WAV; upload raw body | HTTP `202 processing`; correlated `thinking` | WAV metadata + request ID + HTTP/event | Joint |
| HW-AT-005 | Upload without WebSocket | Disconnect socket; upload saved valid WAV | `409 WEBSOCKET_NOT_CONNECTED`; reconnect/auth; same request ID retry | HTTP bodies + attempt log | Joint |
| HW-AT-006 | Invalid WAV | Send noncanonical sample in controlled test build | `422 INVALID_AUDIO_FORMAT`; no same-byte retry | HTTP body + attempt log | Joint |
| HW-AT-007 | Oversized WAV | Send payload over 3145728 bytes in controlled test | `413 AUDIO_TOO_LARGE`; no same-byte retry | byte count + HTTP body | Joint |
| HW-AT-008 | Duplicate upload | Repeat identical WAV and request ID | HTTP `200`, `duplicate:true`; no second playback | HTTP/event/playback count | Joint |
| HW-AT-009 | Request ID conflict | Reuse request ID with different body | `409 REQUEST_ID_CONFLICT`; ID discarded for that recording | hashes/size + HTTP body | Joint |
| HW-AT-010 | Device busy | Start second recording/upload while request active | new request suppressed locally or backend `409 DEVICE_BUSY`; original continues | two request IDs + state log | Joint |
| HW-AT-011 | Reconnect during thinking | Drop socket after `thinking`; reconnect/auth | same active request restored; `thinking` resent | events + request ID | Joint |
| HW-AT-012 | Reconnect at audio ready | Drop socket before consuming `audio_ready`; reconnect/auth | same nonexpired audio is offered again with remaining TTL | event + URL identity + TTL | Joint |
| HW-AT-013 | Duplicate audio ready | Deliver/resend same `audio_ready` during download/play | one download/playback only | playback counter + state log | HW |
| HW-AT-014 | Progressive MP3 playback | Download valid output through bounded buffer | MP3 mono 24 kHz/96 kbps baseline plays audibly without full-file wait | ffprobe metadata + buffer log + human result | HW |
| HW-AT-015 | Download retry | Interrupt first MP3 download | partial buffer discarded; 1s delay; one full restart; no Range dependency | attempt/timestamp log | HW |
| HW-AT-016 | Expired MP3 | Delay controlled download past TTL | HTTP `410 AUDIO_EXPIRED`; no URL retry; error path then `idle` | HTTP/event/display log | Joint |
| HW-AT-017 | Playback done | Finish audible playback | display `idle`; `audio_playback_done`; next request accepted | event + next request result | Joint |
| HW-AT-018 | Playback failed | Force decoder/playback failure after allowed retry | valid `audio_playback_failed` reason; error expression/audio; next request accepted | event + display/audio + next request | Joint |
| HW-AT-019 | Backend request failed | Trigger controlled `NO_SPEECH` and one general recoverable failure | correct `request_failed`; correct local error audio; return `idle` | event + audible/display result | Joint |
| HW-AT-020 | Heartbeat/backoff | Observe idle ping/pong; suppress pong in controlled build | healthy socket stays open; two misses disconnect; 1/2/4/8/16/30s capped backoff | packet/event timestamps | HW |
| HW-AT-021 | Silence stop | Speak then remain silent | recording stops after 2,5s silence within measurement tolerance documented by HW | recording timestamps + WAV duration | HW |
| HW-AT-022 | Hard recording stop | Sustain input beyond limit | recording stops no later than 60s hard limit | timestamps + WAV duration/size | HW |
| HW-AT-023 | Display happy path | Run successful request | `idle → thinking → speaking → idle`; no `listening` mode | video/log timestamps | HW |
| HW-AT-024 | Display/error local | Run request and playback error paths | `error` shown; local error audio attempted; return `idle` | video + audible/log result | HW |
| HW-AT-025 | Terminal-state readiness | After success, backend failure, playback failure, and expired audio, start next request | no stale busy/playback state; each next request accepted | request IDs + state transitions | Joint |

## Final gate

Set status to `HARDWARE INTEGRATION VERIFIED` only when:

1. `DEPLOYMENT_STATUS` is `AVAILABLE`;
2. all 25 cases are `PASS`;
3. no unresolved protocol/security defect remains;
4. progressive physical playback is audible and stable;
5. evidence contains firmware build ID and request IDs;
6. backend and hardware owners sign the run record.

Any `FAIL`, `BLOCKED`, missing evidence, or fake-device-only result prevents final status.
```

- [ ] **Step 4: Run full static handoff verification**

Run:

```powershell
python scripts/verify_hardware_handoff.py
```

Expected:

```text
PASS
Verified hardware handoff files, canonical markers, acceptance IDs, links, and token safety.
```

- [ ] **Step 5: Commit acceptance matrix**

```powershell
git add docs/hardware-handoff/ACCEPTANCE-TESTS.md
git commit -m "docs: add physical ESP32 acceptance matrix"
```

### Task 6: Add checked-in pack integration test

**Files:**
- Modify: `scripts/tests/test_verify_hardware_handoff.py`

- [ ] **Step 1: Add repository integration test**

Add this method to `HardwareHandoffVerifierTests`:

```python
    def test_checked_in_hardware_handoff_pack_is_valid(self) -> None:
        repository_root = Path(__file__).resolve().parents[2]

        self.assertEqual(verify(repository_root), [])
```

- [ ] **Step 2: Run complete verifier tests**

Run:

```powershell
python -m unittest scripts.tests.test_verify_hardware_handoff -v
```

Expected: `Ran 4 tests` and `OK`.

- [ ] **Step 3: Run CLI verifier**

Run:

```powershell
python scripts/verify_hardware_handoff.py
```

Expected: `PASS`.

- [ ] **Step 4: Commit repository integration test**

```powershell
git add scripts/tests/test_verify_hardware_handoff.py
git commit -m "test: verify checked-in hardware handoff pack"
```

### Task 7: Final contract and backend regression audit

**Files:**
- Verify: `docs/hardware-handoff/`
- Verify: `scripts/verify_hardware_handoff.py`
- Verify: `scripts/tests/test_verify_hardware_handoff.py`
- Verify unchanged: `docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`
- Verify unchanged: backend public API/event implementation

- [ ] **Step 1: Scan for unresolved markers, unsafe token assignments, and formatting errors**

Run:

```powershell
rg -n 'TBD|TODO|<IP_VPS>|<DOMAIN_API_BMO>|WEBSOCKET_NOT_READY' docs/hardware-handoff
git diff --check 9364fd8..HEAD
```

Expected: `rg` returns no matches; `git diff --check` prints nothing.

- [ ] **Step 2: Run handoff validation**

Run:

```powershell
python -m unittest scripts.tests.test_verify_hardware_handoff -v
python scripts/verify_hardware_handoff.py
```

Expected: 4 tests pass; CLI prints `PASS`.

- [ ] **Step 3: Prove canonical documentation remains valid**

Run:

```powershell
python scripts/verify-backend-mvp-docs.py
```

Expected:

```text
PASS
Verified 11 package files, exact source hashes, semantic migration §1–§33, canonical decisions, internal path, verification taxonomy, and authorization gate.
```

- [ ] **Step 4: Run backend public-contract regression**

Run:

```powershell
Set-Location backend
npm test
npm run typecheck
npm run build
Set-Location ..
```

Expected: all backend tests pass; current baseline is 21 test files and 99 tests. Typecheck/build exit `0`.

- [ ] **Step 5: Audit scope and tracked files**

Run:

```powershell
git status --short
git diff --name-only 9364fd8..HEAD -- docs/hardware-handoff scripts/verify_hardware_handoff.py scripts/tests
```

Expected new/modified implementation files:

```text
docs/hardware-handoff/ACCEPTANCE-TESTS.md
docs/hardware-handoff/FIRMWARE-CHECKLIST.md
docs/hardware-handoff/STAGING-CONFIG.template.md
docs/hardware-handoff/START-HERE.md
scripts/tests/__init__.py
scripts/tests/test_verify_hardware_handoff.py
scripts/verify_hardware_handoff.py
```

Existing unrelated worktree changes must remain untouched. Canonical hardware contract and backend implementation must not appear in the diff.

- [ ] **Step 6: Correct only evidence-backed defects**

If any verification command fails, change only the handoff document or verifier responsible for that exact failure. Repeat Steps 1–5 until all pass. Do not weaken verifier requirements to hide a real document gap.

- [ ] **Step 7: Commit final corrections only when needed**

```powershell
git add docs/hardware-handoff scripts/verify_hardware_handoff.py scripts/tests
git commit -m "docs: finalize hardware handoff verification"
```

Skip this commit when Step 6 produced no changes.

## Completion Evidence

Implementation is complete only when all evidence exists:

- four handoff documents present;
- 13 original hardware needs mapped explicitly;
- lifecycle/security/version/logging/race concerns included;
- all 25 physical-device acceptance IDs present exactly once;
- no actual device token committed;
- pre-staging state explicitly unavailable;
- local links resolve;
- handoff verifier tests and CLI pass;
- canonical backend documentation verifier passes;
- backend public-contract tests, typecheck, and build pass;
- canonical hardware contract and backend public interface remain unchanged.

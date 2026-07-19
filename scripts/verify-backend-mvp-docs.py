#!/usr/bin/env python3
from pathlib import Path
import hashlib
import re
import sys

root = Path(__file__).resolve().parents[1]
bm = root / "docs" / "backend-mvp"
hw_copy = root / "docs" / "hardware-contract" / "BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md"
prd = root / "docs" / "product" / "BMO-BY-BLABS-PRD-v1.2.0.md"
archive = root / "docs" / "archive" / "BMO-MVP-BACKEND-IMPLEMENTATION-FOR-HERMES-v1.0.5.md"

expected = [
    "00-AGENT-EXECUTION-GUIDE.md",
    "01-SCOPE-AND-DECISIONS.md",
    "02-API-AND-WEBSOCKET-CONTRACT.md",
    "03-BACKEND-ARCHITECTURE.md",
    "04-AUDIO-SERVICE.md",
    "05-TESTING-AND-ACCEPTANCE.md",
    "06-DEPLOYMENT-AND-OPERATIONS.md",
    "IMPLEMENTATION-STATUS.md",
    "REQUIREMENT-TRACEABILITY.md",
    "VERIFICATION-REPORT.md",
    "CHANGELOG.md",
]

source_hashes = {
    prd: "77b4bba8333aa277201976b024466d85c10257b13a63d5f5824b6c94555b70b8",
    archive: "d1554d8d2cdbd6e32cf7acca75ce17031adcc47463b8577f64cdc288fa076853",
    hw_copy: "633e398a7fa39a3ebc469af7f9ca46fd04890339bb132ec7de2c2286207c6a44",
}

section_targets = {
    1: "01-SCOPE-AND-DECISIONS.md", 2: "01-SCOPE-AND-DECISIONS.md", 3: "01-SCOPE-AND-DECISIONS.md",
    4: "06-DEPLOYMENT-AND-OPERATIONS.md", 5: "06-DEPLOYMENT-AND-OPERATIONS.md", 6: "06-DEPLOYMENT-AND-OPERATIONS.md",
    7: "03-BACKEND-ARCHITECTURE.md", 8: "03-BACKEND-ARCHITECTURE.md",
    9: "04-AUDIO-SERVICE.md", 10: "04-AUDIO-SERVICE.md", 11: "04-AUDIO-SERVICE.md", 12: "04-AUDIO-SERVICE.md",
    13: "04-AUDIO-SERVICE.md", 14: "04-AUDIO-SERVICE.md",
    15: "02-API-AND-WEBSOCKET-CONTRACT.md", 16: "02-API-AND-WEBSOCKET-CONTRACT.md", 17: "02-API-AND-WEBSOCKET-CONTRACT.md",
    18: "03-BACKEND-ARCHITECTURE.md", 19: "03-BACKEND-ARCHITECTURE.md", 20: "03-BACKEND-ARCHITECTURE.md",
    21: "03-BACKEND-ARCHITECTURE.md", 22: "02-API-AND-WEBSOCKET-CONTRACT.md", 23: "03-BACKEND-ARCHITECTURE.md",
    24: "03-BACKEND-ARCHITECTURE.md", 25: "06-DEPLOYMENT-AND-OPERATIONS.md", 26: "06-DEPLOYMENT-AND-OPERATIONS.md",
    27: "05-TESTING-AND-ACCEPTANCE.md", 28: "06-DEPLOYMENT-AND-OPERATIONS.md", 29: "06-DEPLOYMENT-AND-OPERATIONS.md",
    30: "05-TESTING-AND-ACCEPTANCE.md", 31: "05-TESTING-AND-ACCEPTANCE.md",
    32: "06-DEPLOYMENT-AND-OPERATIONS.md", 33: "06-DEPLOYMENT-AND-OPERATIONS.md",
}

errors = []
for name in expected:
    if not (bm / name).is_file():
        errors.append(f"missing {name}")

# Canonical copies must remain byte-identical to storage source baselines.
for path, expected_hash in source_hashes.items():
    if not path.is_file():
        errors.append(f"missing canonical reference {path}")
        continue
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected_hash:
        errors.append(f"hash mismatch {path.name}: {actual}")

all_text = "\n".join((bm / n).read_text(encoding="utf-8") for n in expected if (bm / n).is_file())
required_strings = [
    "POST /api/v1/voice", "GET  /audio/:audioId.mp3", "WS   /ws",
    "audio/wav", "multipart/form-data", "PCM signed 16-bit little-endian",
    "16 kHz", "mono", "2,5 detik", "60 detik", "UUID v4", "in-memory",
    "faster-whisper", "Kokoro", "RVC", "FFmpeg", "Always answer in natural English",
    "audio_ready", "audio_playback_done", "audio_playback_failed", "request_failed",
    "4001", "4003", "4008", "WEBSOCKET_NOT_CONNECTED", "REQUEST_ID_CONFLICT",
    "AUDIO_EXPIRED", "idle", "thinking", "speaking", "error", "audio_ready_received",
    "PostgreSQL atau Prisma", "Spotify", "WhatsApp", "mobile app", "firmware ESP32",
]
for value in required_strings:
    if value not in all_text:
        errors.append(f"missing required string: {value}")

# The primary migration matrix must include every source section exactly once.
trace = (bm / "REQUIREMENT-TRACEABILITY.md").read_text(encoding="utf-8")
matrix_match = re.search(
    r"## 2\. Backend source migration matrix(.*?)## 3\.",
    trace,
    re.DOTALL,
)
if not matrix_match:
    errors.append("traceability primary migration matrix not found")
else:
    primary_matrix = matrix_match.group(1)
    rows = re.findall(r"^\| §(\d+) \|", primary_matrix, re.MULTILINE)
    for n in range(1, 34):
        count = rows.count(str(n))
        if count != 1:
            errors.append(f"traceability primary section §{n} count={count}, expected 1")

# Independently verify semantic migration of every top-level source section.
def normalize(text: str) -> str:
    text = text.replace(
        "`BMO-MVP-HW-INTERFACE-CONTRACT.md`",
        "`../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`",
    )
    return re.sub(r"\s+", " ", text.strip())

if archive.is_file():
    source = archive.read_text(encoding="utf-8")
    headings = list(re.finditer(r"^## (\d+)\.\s+.*$", source, re.MULTILINE))
    if len(headings) != 33:
        errors.append(f"source top-level numbered section count={len(headings)}, expected 33")
    for i, match in enumerate(headings):
        number = int(match.group(1))
        # Stop at the next level-2 heading, including unnumbered Changelog after §33.
        next_heading = re.search(r"^##\s+", source[match.end():], re.MULTILINE)
        end = match.end() + next_heading.start() if next_heading else len(source)
        section = source[match.start():end].strip()
        target_name = section_targets.get(number)
        if not target_name:
            errors.append(f"no target mapping for §{number}")
            continue
        target_path = bm / target_name
        if not target_path.is_file():
            continue
        if normalize(section) not in normalize(target_path.read_text(encoding="utf-8")):
            errors.append(f"semantic migration mismatch §{number} -> {target_name}")

status = (bm / "IMPLEMENTATION-STATUS.md").read_text(encoding="utf-8")
if "Documentation package: VERIFIED" not in status:
    errors.append("status missing Documentation package: VERIFIED")

active_match = re.search(r"^Active implementation phase: (NONE|P[1-6])$", status, re.MULTILINE)
authorization_match = re.search(
    r"^Implementation authorization: (NOT GRANTED|P[1-6] ONLY)$",
    status,
    re.MULTILINE,
)
if not active_match:
    errors.append("invalid or missing active implementation phase")
if not authorization_match:
    errors.append("invalid or missing implementation authorization")

phase_rows = {}
for line in status.splitlines():
    if not re.match(r"^\| P[1-6] \|", line):
        continue
    columns = [column.strip() for column in line.strip().strip("|").split("|")]
    if len(columns) != 6:
        errors.append(f"malformed implementation phase row: {line}")
        continue
    phase, _scope, _required_docs, phase_status, authorization, _evidence = columns
    phase_rows[phase] = (phase_status, authorization)

valid_statuses = {
    "NOT_STARTED",
    "READY",
    "AUTHORIZED",
    "IN_PROGRESS",
    "BLOCKED",
    "IMPLEMENTED",
    "IMPLEMENTED — not VERIFIED",
    "VERIFIED",
    "VERIFIED — BACKEND",
    "VERIFIED — LOCAL FUNCTIONAL",
    "VERIFIED — DEPLOYMENT",
    "HARDWARE INTEGRATION VERIFIED",
}
if set(phase_rows) != {f"P{number}" for number in range(1, 7)}:
    errors.append("implementation phase table must contain P1-P6 exactly once")
for phase, (phase_status, _authorization) in phase_rows.items():
    if phase_status not in valid_statuses:
        errors.append(f"invalid implementation status {phase}: {phase_status}")

if active_match and authorization_match and len(phase_rows) == 6:
    active_phase = active_match.group(1)
    authorization_state = authorization_match.group(1)
    if authorization_state == "NOT GRANTED":
        if active_phase != "NONE":
            errors.append("active phase must be NONE when authorization is NOT GRANTED")
        for phase, (_phase_status, authorization) in phase_rows.items():
            if authorization != "NOT AUTHORIZED":
                errors.append(f"{phase} authorization must be NOT AUTHORIZED")
    else:
        authorized_phase = authorization_state.split()[0]
        authorized_number = int(authorized_phase[1])
        if active_phase != authorized_phase:
            errors.append(f"active phase {active_phase} differs from authorized phase {authorized_phase}")
        for phase, (phase_status, authorization) in phase_rows.items():
            phase_number = int(phase[1])
            if phase_number < authorized_number:
                if authorization != "AUTHORIZED BY USER":
                    errors.append(f"completed prior phase {phase} must retain authorization evidence")
                if phase_status not in {"IMPLEMENTED", "IMPLEMENTED — not VERIFIED", "VERIFIED", "VERIFIED — BACKEND", "VERIFIED — LOCAL FUNCTIONAL", "VERIFIED — DEPLOYMENT", "HARDWARE INTEGRATION VERIFIED"}:
                    errors.append(f"completed prior phase {phase} status {phase_status} is invalid")
            elif phase == authorized_phase:
                if authorization != "AUTHORIZED BY USER":
                    errors.append(f"{phase} lacks explicit user authorization evidence")
                if phase_status not in {"AUTHORIZED", "IN_PROGRESS", "BLOCKED", "IMPLEMENTED", "IMPLEMENTED — not VERIFIED", "VERIFIED", "VERIFIED — BACKEND", "VERIFIED — LOCAL FUNCTIONAL"}:
                    errors.append(f"{phase} status {phase_status} is invalid after authorization")
            else:
                if phase_status != "NOT_STARTED":
                    errors.append(f"future phase {phase} must remain NOT_STARTED")
                if authorization != "NOT AUTHORIZED":
                    errors.append(f"future phase {phase} must remain NOT AUTHORIZED")

# Stable filenames: status belongs in tracker, not filename suffixes.
for path in bm.glob("*.md"):
    if re.search(r"_(belum|sudah|not-started|implemented|verified)", path.name, re.IGNORECASE):
        errors.append(f"status suffix in filename: {path.name}")

# Active API doc must point to the actual versioned canonical contract path.
api_doc = (bm / "02-API-AND-WEBSOCKET-CONTRACT.md").read_text(encoding="utf-8")
canonical_path = "../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md"
if canonical_path not in api_doc:
    errors.append("API contract missing versioned hardware-contract path")
if not (bm / canonical_path).resolve().is_file():
    errors.append("versioned hardware-contract path does not resolve")

if errors:
    print("FAIL")
    for error in errors:
        print("-", error)
    sys.exit(1)

print("PASS")
print("Verified 11 package files, exact source hashes, semantic migration §1–§33, canonical decisions, internal path, verification taxonomy, and authorization gate.")

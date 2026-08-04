#!/usr/bin/env python3
from pathlib import Path
import hashlib
import re
import sys

def resolve_root() -> Path:
    if len(sys.argv) == 3 and sys.argv[1] == "--root":
        return Path(sys.argv[2]).resolve()
    return Path(__file__).resolve().parents[1]


root = resolve_root()
docs = root / "docs"
bm = root / "docs" / "backend-mvp"
hw_copy = root / "docs" / "hardware-contract" / "BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md"
prd = root / "docs" / "product" / "BMO-BY-BLABS-PRD-v1.2.4.md"
archive = root / "docs" / "archive" / "BMO-MVP-BACKEND-IMPLEMENTATION-FOR-HERMES-v1.0.5.md"

PRE_P9_IMPLEMENTATION_STATE = "P9 implementation state: NOT_STARTED / AWAITING EXPLICIT USER AUTHORIZATION"
P9_1_ISOLATED_IMPLEMENTATION_STATE = "P9.1 implementation state: ISOLATED CANDIDATE IMPLEMENTED / READY FOR REVIEW"


def validate_p9_phase_status(status: str) -> tuple[str, list[str]]:
    """Validate the pre-P9 and isolated P9.1 implementation-control states."""
    errors: list[str] = []
    candidate_expected_value = P9_1_ISOLATED_IMPLEMENTATION_STATE.split(": ", 1)[1]
    pre_p9_expected_value = PRE_P9_IMPLEMENTATION_STATE.split(": ", 1)[1]
    candidate_declarations = re.findall(
        r"^P9\.1 implementation state:\s*(.+?)\s*$",
        status,
        re.MULTILINE,
    )
    pre_p9_declarations = re.findall(
        r"^P9 implementation state:\s*(.+?)\s*$",
        status,
        re.MULTILINE,
    )

    if candidate_declarations == [candidate_expected_value] and not pre_p9_declarations:
        stage = "P9.1-isolated-candidate"
    elif pre_p9_declarations == [pre_p9_expected_value] and not candidate_declarations:
        stage = "pre-P9"
    else:
        stage = "unknown"
        declared = " ".join(candidate_declarations + pre_p9_declarations)
        if re.search(r"\b(?:PRODUCTION|DEPLOYED|ACTIVE)\b", declared, re.IGNORECASE):
            errors.append("P9.1 isolated candidate must not be marked production")
        else:
            errors.append(f"unrecognized P9 implementation state: {declared or '<missing>'}")

    common_control_state = [
        "Documentation package: CURRENT / P8 PRODUCTION CLOSED",
        "Current next implementation phase: P9.1 — PostgreSQL, auth, pairing, settings foundation",
        "P6 state: VERIFIED",
        "P6 execution authorization: COMPLETED",
        "P7 state: VERIFIED — PRODUCTION",
        "P7 execution: COMPLETED",
        "P8 state: P8_PIPER_PRODUCTION_VERIFIED",
        "P9.1 architecture state: LOCKED / APPROVED",
        "P10 state: NOT_STARTED / dependency-gated after P9.6",
    ]
    for value in common_control_state:
        if value not in status:
            errors.append(f"status missing current control state: {value}")

    if stage == "P9.1-isolated-candidate" and "P9.2–P9.6 implementation state: NOT IMPLEMENTED" not in status:
        errors.append("P9.2–P9.6 must remain PROPOSED; NOT_STARTED")

    phase_rows: dict[str, tuple[str, str]] = {}
    for line in status.splitlines():
        if not re.match(r"^\| (?:P[1-8]|P9\.1|P9\.2–P9\.6|P10) \|", line):
            continue
        columns = [column.strip() for column in line.strip().strip("|").split("|")]
        if len(columns) != 6:
            errors.append(f"malformed implementation phase row: {line}")
            continue
        phase, _scope, _required_docs, phase_status, authorization, _evidence = columns
        if phase in phase_rows:
            errors.append(f"duplicate implementation phase row: {phase}")
        phase_rows[phase] = (phase_status, authorization)

    expected_p9_1 = (
        ("IMPLEMENTED — ISOLATED / READY FOR REVIEW", "AUTHORIZED")
        if stage == "P9.1-isolated-candidate"
        else ("ARCHITECTURE LOCKED; NOT_STARTED", "AWAITING EXPLICIT USER AUTHORIZATION")
    )
    expected_phase_rows = {
        "P1": ("VERIFIED — BACKEND", "AUTHORIZED BY USER"),
        "P2": ("VERIFIED — LOCAL FUNCTIONAL", "AUTHORIZED BY USER"),
        "P3": ("IMPLEMENTED — not VERIFIED", "AUTHORIZED BY USER"),
        "P4": ("VERIFIED — LOCAL FUNCTIONAL", "AUTHORIZED BY USER"),
        "P5": ("VERIFIED — BACKEND", "AUTHORIZED BY USER"),
        "P6": ("VERIFIED", "COMPLETED"),
        "P7": ("VERIFIED — PRODUCTION", "COMPLETED"),
        "P8": ("VERIFIED — PRODUCTION", "COMPLETED"),
        "P9.1": expected_p9_1,
        "P9.2–P9.6": ("PROPOSED; NOT_STARTED", "DEPENDS ON PREDECESSOR GATES"),
        "P10": (
            "NOT_STARTED",
            "DEPENDS ON P9.6 VERIFIED; ALSO REQUIRES P7 PUBLIC ENDPOINT + P8 STATUS",
        ),
    }
    if set(phase_rows) != set(expected_phase_rows):
        errors.append("implementation phase table must contain P1-P10 exactly once")
    for phase, expected_state in expected_phase_rows.items():
        if phase_rows.get(phase) != expected_state:
            errors.append(
                f"invalid current phase state {phase}: {phase_rows.get(phase)}, "
                f"expected {expected_state}",
            )
            if phase == "P9.2–P9.6":
                errors.append("P9.2–P9.6 must remain PROPOSED; NOT_STARTED")

    return stage, errors


expected = [
    "00-AGENT-EXECUTION-GUIDE.md",
    "01-SCOPE-AND-DECISIONS.md",
    "02-API-AND-WEBSOCKET-CONTRACT.md",
    "03-BACKEND-ARCHITECTURE.md",
    "04-AUDIO-SERVICE.md",
    "05-TESTING-AND-ACCEPTANCE.md",
    "06-DEPLOYMENT-AND-OPERATIONS.md",
    "CURRENT-RUNTIME-CONFIG.md",
    "IMPLEMENTATION-STATUS.md",
    "P6-TEST-EVIDENCE.md",
    "P7-TEST-EVIDENCE.md",
    "REQUIREMENT-TRACEABILITY.md",
    "VERIFICATION-REPORT.md",
    "CHANGELOG.md",
]

source_hashes = {
    prd: "2928ac05023e76ae463dfaaefbc0141d42d97b796c276ef4c779c46b23ac78e3",
    archive: "d1554d8d2cdbd6e32cf7acca75ce17031adcc47463b8577f64cdc288fa076853",
    hw_copy: "633e398a7fa39a3ebc469af7f9ca46fd04890339bb132ec7de2c2286207c6a44",
}

def canonical_text_bytes(path: Path) -> bytes:
    """Return the LF form stored by Git for locked text documents."""
    return path.read_bytes().replace(b"\r\n", b"\n")


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
    actual = hashlib.sha256(canonical_text_bytes(path)).hexdigest()
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
    "WHISPER_MODEL=medium", "WHISPER_HOTWORDS=BMO",
    "KOKORO_VOICE=af_heart", "KOKORO_SPEED=0.80",
    "Real RVC inference remains unverified",
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
    rows = re.findall(
        r"^\| §(\d+) \|.*?\| `([^`]+)` \| MIGRATED \|$",
        primary_matrix,
        re.MULTILINE,
    )
    for n in range(1, 34):
        matches = [target for number, target in rows if number == str(n)]
        if len(matches) != 1:
            errors.append(f"traceability primary section §{n} count={len(matches)}, expected 1")
        elif matches[0] != section_targets[n]:
            errors.append(
                f"traceability primary section §{n} target={matches[0]}, "
                f"expected {section_targets[n]}",
            )

# The archived source remains immutable and structurally complete. Active docs may
# intentionally supersede operational details, so validate explicit traceability
# plus current-state assertions instead of requiring obsolete sections verbatim.
if archive.is_file():
    source = archive.read_text(encoding="utf-8")
    headings = list(re.finditer(r"^## (\d+)\.\s+.*$", source, re.MULTILINE))
    if len(headings) != 33:
        errors.append(f"source top-level numbered section count={len(headings)}, expected 33")
    numbers = [int(match.group(1)) for match in headings]
    if numbers != list(range(1, 34)):
        errors.append(f"source numbered sections are not exactly §1–§33: {numbers}")

status = (bm / "IMPLEMENTATION-STATUS.md").read_text(encoding="utf-8")
p9_stage, p9_stage_errors = validate_p9_phase_status(status)
errors.extend(p9_stage_errors)

p10_rows = [line for line in status.splitlines() if line.startswith("| P10 |")]
if len(p10_rows) != 1 or "physical ESP32 acceptance" not in p10_rows[0]:
    errors.append("P10 must remain final hardware integration/acceptance")

p7_rows = [line for line in status.splitlines() if line.startswith("| P7 |")]
if len(p7_rows) != 1 or "P7-TEST-EVIDENCE.md" not in p7_rows[0]:
    errors.append("P7 must remain VERIFIED — PRODUCTION with P7 evidence")

p8_rows = [line for line in status.splitlines() if line.startswith("| P8 |")]
if len(p8_rows) != 1 or "P8-EXECUTION-SPEC.md" not in p8_rows[0] or "P8-PRODUCTION-ROLLOUT-EVIDENCE.md" not in p8_rows[0]:
    errors.append("P8 must remain VERIFIED — PRODUCTION with closure evidence")

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

def read_utf8(path: Path) -> str:
    if not path.is_file():
        errors.append(f"missing active file {path.relative_to(root)}")
        return ""
    data = path.read_bytes()
    if b"\x00" in data:
        errors.append(f"NUL byte in active file {path.relative_to(root)}")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as error:
        errors.append(f"invalid UTF-8 in active file {path.relative_to(root)}: {error}")
        return ""


active_docs = [
    root / "README.md",
    docs / "README.md",
    docs / "NEXT-ACTION.md",
    docs / "roadmap" / "P6-EXECUTION-SPEC.md",
    docs / "roadmap" / "P8-EXECUTION-SPEC.md",
    docs / "roadmap" / "P6-P10-ROADMAP.md",
    docs / "operations" / "MAINTENANCE-AND-RECOVERY.md",
    prd,
    hw_copy,
    *(bm / name for name in expected),
    *(docs / "hardware-handoff" / name for name in [
        "README.md",
        "CURRENT-STATUS.md",
        "DEPLOYMENT-CONFIG.md",
        "AGENT-CONTEXT.md",
        "FIRMWARE-CHECKLIST.md",
        "ACCEPTANCE-TESTS.md",
    ]),
]
active_doc_text = {path: read_utf8(path) for path in active_docs}

root_readme = active_doc_text[root / "README.md"]
entry_chain = [
    "docs/README.md",
    "docs/NEXT-ACTION.md",
    "docs/roadmap/P8-EXECUTION-SPEC.md",
    "docs/backend-mvp/IMPLEMENTATION-STATUS.md",
]
entry_positions = [root_readme.find(value) for value in entry_chain]
if any(position < 0 for position in entry_positions) or entry_positions != sorted(entry_positions):
    errors.append(f"root README must contain ordered agent entry chain: {' -> '.join(entry_chain)}")
if "docs/product/BMO-BY-BLABS-PRD-v1.2.4.md" not in root_readme:
    errors.append("root README missing current PRD v1.2.4")
if "BMO-BY-BLABS-PRD-v1.2.0.md" in root_readme:
    errors.append("root README still points to historical PRD v1.2.0")

docs_readme = active_doc_text[docs / "README.md"]
next_action = active_doc_text[docs / "NEXT-ACTION.md"]
p6_spec = active_doc_text[docs / "roadmap" / "P6-EXECUTION-SPEC.md"]
p8_spec = active_doc_text[docs / "roadmap" / "P8-EXECUTION-SPEC.md"]
roadmap = active_doc_text[docs / "roadmap" / "P6-P10-ROADMAP.md"]
runtime_config = active_doc_text[bm / "CURRENT-RUNTIME-CONFIG.md"]
deployment_doc = active_doc_text[bm / "06-DEPLOYMENT-AND-OPERATIONS.md"]
scope_doc = active_doc_text[bm / "01-SCOPE-AND-DECISIONS.md"]
implementation_status = active_doc_text[bm / "IMPLEMENTATION-STATUS.md"]
p6_evidence = active_doc_text[bm / "P6-TEST-EVIDENCE.md"]
p7_evidence = active_doc_text[bm / "P7-TEST-EVIDENCE.md"]
recovery_doc = active_doc_text[docs / "operations" / "MAINTENANCE-AND-RECOVERY.md"]
execution_guide = active_doc_text[bm / "00-AGENT-EXECUTION-GUIDE.md"]
testing_doc = active_doc_text[bm / "05-TESTING-AND-ACCEPTANCE.md"]
hardware_status = active_doc_text[docs / "hardware-handoff" / "CURRENT-STATUS.md"]
deployment_config = active_doc_text[docs / "hardware-handoff" / "DEPLOYMENT-CONFIG.md"]

if p9_stage == "P9.1-isolated-candidate":
    p9_readme = read_utf8(docs / "p9" / "README.md")
    p9_implementation_evidence = read_utf8(docs / "p9" / "P9.1-IMPLEMENTATION-EVIDENCE.md")
    p9_review_evidence = read_utf8(docs / "p9" / "P9.1-FOUNDATION-REVIEW.md")
    candidate_evidence_requirements = {
        "docs/p9/README.md": (
            p9_readme,
            [
                "no P9.1 candidate is deployed to production",
                "P9.2–P9.6 remain proposed",
                "not implemented",
            ],
        ),
        "docs/p9/P9.1-IMPLEMENTATION-EVIDENCE.md": (
            p9_implementation_evidence,
            [
                "This evidence is for the isolated candidate only.",
                "does not authorize a",
                "production deployment",
                "No production Compose, Caddy, DNS, service, or Audio behavior was changed.",
                "P9.2–P9.6: not implemented",
            ],
        ),
        "docs/p9/P9.1-FOUNDATION-REVIEW.md": (
            p9_review_evidence,
            [
                "P9_1_FOUNDATION_REVIEW_APPROVED",
                "No merge, production deployment, production restart, production",
                "No production",
                "Compose, Caddy, DNS, Backend, Audio, Hermes, or Hardware Contract file was",
            ],
        ),
    }
    for label, (text, required_values) in candidate_evidence_requirements.items():
        for value in required_values:
            if value not in text:
                errors.append(f"{label} missing isolated P9.1 safety assertion: {value}")

current_doc_requirements = {
    "docs/README.md": (
        docs_readme,
        [
            "NEXT-ACTION.md",
            "roadmap/P8-EXECUTION-SPEC.md",
            "roadmap/P6-EXECUTION-SPEC.md",
            "product/BMO-BY-BLABS-PRD-v1.2.4.md",
            "P7 is `VERIFIED — PRODUCTION`",
            "real RVC inference is not verified",
            "physical ESP32 integration is not verified",
        ],
    ),
    "docs/NEXT-ACTION.md": (
        next_action,
        [
            "Current next phase:",
            "P9.1 — PostgreSQL, auth, pairing, and settings foundation",
            "Phase state:** `P8_PIPER_PRODUCTION_VERIFIED; P9.1 ARCHITECTURE LOCKED; P9 implementation NOT_STARTED / AWAITING EXPLICIT USER AUTHORIZATION`",
            "P7 is `VERIFIED — PRODUCTION`",
            "P8 is `P8_PIPER_PRODUCTION_VERIFIED`",
            "P8 completion does **not** authorize P9",
            "execute P9",
            "Do not execute P10",
        ],
    ),
    "docs/roadmap/P6-EXECUTION-SPEC.md": (
        p6_spec,
        [
            "Status:** `VERIFIED`",
            "Next phase after verification:** P7",
            "P6 does **not** build/start the BMO backend/audio application",
        ],
    ),
    "docs/roadmap/P8-EXECUTION-SPEC.md": (
        p8_spec,
        [
            "Status:** `P8_PIPER_PRODUCTION_VERIFIED`",
            "Dependency:** P7 `VERIFIED — PRODUCTION`",
            "../backend-mvp/P7-TEST-EVIDENCE.md",
            "audio-service/app/rvc.py",
            "audio-service/scripts/bootstrap_rvc.py",
            "82a8bc529bd41b930589188ead30f073d4f99fc0",
            "dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0",
            "Treat PyTorch checkpoints as untrusted",
            "Historical P3 evidence records",
            "classify P8 as",
            "network-disabled sandbox",
            "Do not execute P8 solely because this spec exists.",
            "do not auto-start P9",
        ],
    ),
    "docs/roadmap/P6-P10-ROADMAP.md": (
        roadmap,
        [
            "P6 → P7 → P8 → P9.1 → P9.2 → P9.3 → P9.4 → P9.5 → P9.6 → P10",
            "P7 — Deploy Backend + Audio Service + Hermes Integration",
            "Phase status:** `VERIFIED — PRODUCTION`",
            "P8 — Fixed Piper Production TTS and RVC Boundary",
            "Phase status:** `VERIFIED — PRODUCTION`",
            "P9 — PostgreSQL + Prisma Ready-to-Use Data Layer",
            "P10 — Hardware Handoff Activation and Physical Integration",
        ],
    ),
    "docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md": (
        runtime_config,
        [
            "WHISPER_MODEL=medium",
            "WHISPER_HOTWORDS=BMO",
            "WHISPER_DEVICE=cpu",
            "WHISPER_COMPUTE_TYPE=int8",
            "WHISPER_CPU_THREADS=4",
            "WHISPER_WORKERS=1",
            "WHISPER_BEAM_SIZE=5",
            "WHISPER_VAD=true",
            "KOKORO_LANG_CODE=a",
            "KOKORO_VOICE=af_heart",
            "KOKORO_SPEED=0.80",
            "Systran/faster-whisper-medium",
            "08e178d48790749d25932bbc082711ddcfdfbc4f",
            "hexgrad/Kokoro-82M",
            "f3ff3571791e39611d31c381e3a41a3af07b4987",
            "en_core_web_sm==3.8.0",
            "MODEL_DOWNLOAD_ALLOWED=false",
            "RVC_ENABLED=false",
            "d2761b191eed48e85128e774aa7057153d8e8994e2e4f40c07ffb05731ae7e9f",
            "Real RVC inference remains unverified",
        ],
    ),
    "docs/backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md": (
        deployment_doc,
        [
            "/opt/bmo/",
            "Status:** VERIFIED — PRODUCTION",
            "4d7b472adc4c2243d8f7364032a491ad70efb6d3",
            "bmo-backend@sha256:e981751498fca13bf1f1c1c046a6874a490b3e681aeef9787a53181059506fd7",
            "bmo-audio@sha256:62d8b48feb978e303831e20dc558cb95d3240af9a3cf09e8dcd0c82142986e7e",
            "/opt/bmo/models/runtime/MODEL_MANIFEST.json",
            "/opt/bmo/cache/audio",
            "/opt/bmo/temp/tts",
            "RVC_ENABLED=false",
            "P7 production runs without PostgreSQL.",
        ],
    ),
    "docs/backend-mvp/P6-TEST-EVIDENCE.md": (
        p6_evidence,
        [
            "Status:** `VERIFIED`",
            "Direct strict test",
            "Beszel relay test",
            "Operator confirmed both receipts",
            "P7 status:** `NOT_STARTED`",
        ],
    ),
    "docs/backend-mvp/P7-TEST-EVIDENCE.md": (
        p7_evidence,
        [
            "Status:** `VERIFIED — PRODUCTION`",
            "Verified at:** `2026-07-31T03:22:12Z`",
            "Closure classification: `VERIFIED — PRODUCTION`",
            "e7969e867c3bcc256b30f15736fd705a4a3c719c",
            "deployment source",
            "P8 `NOT_STARTED / AWAITING EXPLICIT USER AUTHORIZATION`",
        ],
    ),
}
for label, (text, required_values) in current_doc_requirements.items():
    for value in required_values:
        if value not in text:
            errors.append(f"{label} missing current-state assertion: {value}")

unique_state_declarations = [
    (
        "docs/NEXT-ACTION.md phase state",
        next_action,
        r"^\*\*Phase state:\*\*\s*`([^`]+)`\s*$",
        "P8_PIPER_PRODUCTION_VERIFIED; P9.1 ARCHITECTURE LOCKED; P9 implementation NOT_STARTED / AWAITING EXPLICIT USER AUTHORIZATION",
    ),
    (
        "docs/roadmap/P8-EXECUTION-SPEC.md status",
        p8_spec,
        r"^\*\*Status:\*\*\s*`([^`]+)`\s*$",
        "P8_PIPER_PRODUCTION_VERIFIED",
    ),
    (
        "docs/roadmap/P6-P10-ROADMAP.md current next phase",
        roadmap,
        r"^\*\*Current next phase:\*\*\s*(.+?)\s*$",
        "P9.1 — `ARCHITECTURE LOCKED; NOT_STARTED / AWAITING EXPLICIT USER AUTHORIZATION`",
    ),
    (
        "docs/backend-mvp/IMPLEMENTATION-STATUS.md P8 control state",
        implementation_status,
        r"^P8 state:\s*(.+?)\s*$",
        "P8_PIPER_PRODUCTION_VERIFIED",
    ),
]
for label, text, pattern, expected_value in unique_state_declarations:
    declarations = re.findall(pattern, text, re.MULTILINE)
    if declarations != [expected_value]:
        errors.append(
            f"{label} declarations={declarations!r}, expected exactly "
            f"[{expected_value!r}]",
        )

deployment_values = {}
for line in deployment_config.splitlines():
    match = re.fullmatch(r"([A-Z][A-Z0-9_]+): (.+)", line.strip())
    if match:
        key, value = match.groups()
        if key in deployment_values:
            errors.append(f"duplicate hardware deployment key: {key}")
        deployment_values[key] = value

expected_deployment_values = {
    "DEPLOYMENT_STATUS": "VERIFIED",
    "VERIFIED_AT": "2026-08-03",
    "DEPLOYED_COMMIT": "4e2cbda3f8eb02e27120821a11233e7848699249",
    "HTTPS_BASE_URL": "https://api.personalbmo.web.id",
    "WEBSOCKET_URL": "wss://api.personalbmo.web.id/ws",
    "HEALTH_URL": "https://api.personalbmo.web.id/health",
    "UPLOAD_URL": "https://api.personalbmo.web.id/api/v1/voice",
    "AUDIO_URL_PATTERN": "https://api.personalbmo.web.id/audio/<audio-uuid>.mp3",
    "DEVICE_ID": "bmo-001",
    "DEVICE_TOKEN": "PROVIDED_OUT_OF_BAND",
    "PUBLIC_E2E_STATUS": "PASS — P8 NATIVE EQUIVALENT 12/12",
    "PHYSICAL_ESP32_STATUS": "NOT_RUN",
}
for key, expected_value in expected_deployment_values.items():
    if deployment_values.get(key) != expected_value:
        errors.append(
            f"hardware deployment config invalid {key}: "
            f"{deployment_values.get(key)!r}, expected {expected_value!r}",
        )

for label, text in {
    "docs/README.md": docs_readme,
    "docs/NEXT-ACTION.md": next_action,
    "docs/backend-mvp/IMPLEMENTATION-STATUS.md": implementation_status,
    "docs/backend-mvp/P7-TEST-EVIDENCE.md": p7_evidence,
    "docs/hardware-handoff/CURRENT-STATUS.md": hardware_status,
}.items():
    if not re.search(
        r"real\s+RVC.{0,120}(?:not verified|unverified|not\s+started)",
        text,
        re.IGNORECASE | re.DOTALL,
    ):
        errors.append(f"{label} must state that real RVC is unverified")

current_authorities = {
    "README.md": root_readme,
    "docs/README.md": docs_readme,
    "docs/NEXT-ACTION.md": next_action,
    "docs/roadmap/P6-P10-ROADMAP.md": roadmap,
    "docs/roadmap/P8-EXECUTION-SPEC.md": p8_spec,
    "docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md": runtime_config,
    "docs/backend-mvp/IMPLEMENTATION-STATUS.md": implementation_status,
    "docs/backend-mvp/00-AGENT-EXECUTION-GUIDE.md": execution_guide,
    "docs/backend-mvp/01-SCOPE-AND-DECISIONS.md": scope_doc,
    "docs/backend-mvp/04-AUDIO-SERVICE.md": active_doc_text[bm / "04-AUDIO-SERVICE.md"],
    "docs/backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md": deployment_doc,
    "docs/operations/MAINTENANCE-AND-RECOVERY.md": recovery_doc,
    "docs/hardware-handoff/README.md": active_doc_text[docs / "hardware-handoff" / "README.md"],
    "docs/hardware-handoff/CURRENT-STATUS.md": hardware_status,
    "docs/hardware-handoff/DEPLOYMENT-CONFIG.md": deployment_config,
    "docs/hardware-handoff/AGENT-CONTEXT.md": active_doc_text[docs / "hardware-handoff" / "AGENT-CONTEXT.md"],
    "docs/hardware-handoff/FIRMWARE-CHECKLIST.md": active_doc_text[docs / "hardware-handoff" / "FIRMWARE-CHECKLIST.md"],
    "docs/hardware-handoff/ACCEPTANCE-TESTS.md": active_doc_text[docs / "hardware-handoff" / "ACCEPTANCE-TESTS.md"],
}
for label, text in current_authorities.items():
    normalized_text = re.sub(r"[*`]", "", text)
    for pattern, description in [
        (r"\bP7\s+(?:is\s+)?(?:the\s+)?next\b", "P7 is next"),
        (r"P7 state:\s*NOT_STARTED", "P7 state is NOT_STARTED"),
        (r"P7 status:\s*NOT_STARTED", "P7 status is NOT_STARTED"),
        (r"DEPLOYMENT_STATUS:\s*NOT_VERIFIED", "deployment is NOT_VERIFIED"),
        (r"CURRENT DEPLOYMENT TARGET\s*[—-]\s*NOT YET", "deployment is target-only"),
        (r"backend has not yet been verified as deployed", "backend deployment is unverified"),
        (r"hardware must wait for P7", "hardware is waiting for P7"),
        (
            r"^P8(?: state| status| phase state):\s*"
            r"(?:READY|AUTHORIZED|IN_PROGRESS|VERIFIED)\b",
            "P8 has a contradictory authorized/active/verified state",
        ),
        (
            r"^P9(?: state| status| phase state):\s*"
            r"(?:READY|AUTHORIZED|IN_PROGRESS|VERIFIED)\b",
            "P9 has a contradictory authorized/active/verified state",
        ),
        (
            r"^P10(?: state| status| phase state):\s*"
            r"(?:READY|AUTHORIZED|IN_PROGRESS|VERIFIED)\b",
            "P10 has a contradictory authorized/active/verified state",
        ),
        (
            r"\bP(?:9|10) is (?:READY|AUTHORIZED|IN_PROGRESS|VERIFIED)\b",
            "a gated future phase is described as ready/authorized/active/verified",
        ),
        (
            r"\bP(?:9|10) (?:may|can|should|must) "
            r"(?:be )?(?:executed|started|begun|execute|start|begin)(?: now)?\b",
            "a gated future phase is allowed to execute/start",
        ),
        (
            r"\bP(?:9|10) (?:execution )?is authorized to "
            r"(?:execute|start|begin)\b",
            "a gated future phase is authorized to execute/start",
        ),
        (
            r"\bP7 (?:completion|verification) (?:automatically )?"
            r"(?:authorizes|permits|starts) P8\b",
            "P7 incorrectly authorizes P8",
        ),
        (r"\bP8 is authorized by P7\b", "P8 is incorrectly authorized by P7"),
        (
            r"\bP8 (?:completion|verification) (?:automatically )?"
            r"(?:authorizes|permits|starts) P9\b",
            "P8 incorrectly auto-authorizes P9",
        ),
        (
            r"\b(?:(?:may|can|should|must) skip P8|"
            r"P9 (?:may|can|should|must) (?:be )?executed? before P8|"
            r"(?:may|can|should|must) jump from P7 directly to P9)\b",
            "P9 can incorrectly bypass the P8 gate",
        ),
    ]:
        if re.search(pattern, normalized_text, re.IGNORECASE | re.MULTILINE):
            errors.append(f"{label} contains stale current state: {description}")

hermes_phase_requirements = {
    "docs/backend-mvp/00-AGENT-EXECUTION-GUIDE.md": (
        execution_guide,
        [
            "P6-verified Hermes host API",
            "If Hermes is absent",
            "initial host-runtime bootstrap",
        ],
    ),
    "docs/NEXT-ACTION.md": (
        next_action,
        [
            "production Hermes integration",
            "127.0.0.1:8642",
            "private origins only",
        ],
    ),
    "docs/roadmap/P6-EXECUTION-SPEC.md": (
        p6_spec,
        [
            "PRESENT",
            "ABSENT",
            "Task 1A — Conditional Hermes host runtime",
            "Hermes remains a host runtime and is never Dockerized.",
            "Do not create a dedicated Linux user solely for Hermes",
            "actual runtime user",
            "actual install, config, and data paths",
            "startup/service mechanism",
            "127.0.0.1:8642",
            "no public `:8642` exposure",
            "restart behavior is verified",
            "recovery/start procedure is documented",
        ],
    ),
    "docs/roadmap/P6-P10-ROADMAP.md": (
        roadmap,
        [
            "preserve it when present; bootstrap it when absent",
            "P6-verified Hermes host API healthy",
            "P7 integrates backend/audio with Hermes; it does not perform initial Hermes installation.",
        ],
    ),
    "docs/backend-mvp/01-SCOPE-AND-DECISIONS.md": (
        scope_doc,
        [
            "Preserve If Present, Bootstrap If Absent",
            "Hermes present",
            "Hermes absent",
            "127.0.0.1:8642",
        ],
    ),
    "docs/backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md": (
        deployment_doc,
        [
            "If Hermes is present",
            "If Hermes is absent",
            "Hermes remains a host runtime and is never Dockerized.",
            "conditional",
            "host bootstrap",
        ],
    ),
    "docs/backend-mvp/IMPLEMENTATION-STATUS.md": (
        implementation_status,
        [
            "P6 owned conditional Hermes host bootstrap",
            "P7 remained integration-only and did not own initial Hermes installation.",
            "production VPS preflight reported Hermes `ABSENT`",
        ],
    ),
    "docs/backend-mvp/05-TESTING-AND-ACCEPTANCE.md": (
        testing_doc,
        [
            "Hermes host runtime sehat dan loopback-only.",
            "PRESENT",
            "ABSENT",
        ],
    ),
    "docs/operations/MAINTENANCE-AND-RECOVERY.md": (
        recovery_doc,
        [
            "Hermes present",
            "Hermes absent",
            "actual Hermes startup/service mechanism",
            "127.0.0.1:8642",
        ],
    ),
}
for label, (text, required_values) in hermes_phase_requirements.items():
    for value in required_values:
        if value not in text:
            errors.append(f"{label} missing conditional Hermes assertion: {value}")

obsolete_hermes_assumptions = {
    "docs/roadmap/P6-EXECUTION-SPEC.md": (
        p6_spec,
        "Runtime dependency to preserve:** existing Hermes host service",
    ),
    "docs/roadmap/P6-P10-ROADMAP.md": (
        roadmap,
        "existing Hermes API healthy on host",
    ),
    "docs/backend-mvp/01-SCOPE-AND-DECISIONS.md": (
        scope_doc,
        "Hermes sudah berjalan langsung di host VPS",
    ),
}
for label, (text, obsolete_value) in obsolete_hermes_assumptions.items():
    if obsolete_value in text:
        errors.append(f"{label} still assumes Hermes already exists: {obsolete_value}")

for value in [
    "Hermes host bootstrap clarification",
    "production VPS preflight reported Hermes absent",
    "P6 re-confirmed",
    "the `ABSENT` branch",
    "does not modify the",
    "locked PRD snapshot or hardware contract",
]:
    if value not in docs_readme:
        errors.append(f"docs/README.md missing Hermes operational clarification: {value}")

active_source_paths = [
    *sorted((root / "backend" / "src").rglob("*.ts")),
    *sorted((root / "backend" / "scripts").rglob("*.ts")),
    *sorted((root / "audio-service" / "app").rglob("*.py")),
    *sorted((root / "audio-service" / "scripts").rglob("*.py")),
]
active_source_text = {path: read_utf8(path) for path in active_source_paths}
legacy_deployment_root = "".join(("/opt/", "bmo-mvp"))
for path, text in {**active_doc_text, **active_source_text}.items():
    if legacy_deployment_root in text:
        errors.append(f"legacy deployment root in active file {path.relative_to(root)}")

audio_config = active_source_text[root / "audio-service" / "app" / "config.py"]
runtime_source_requirements = {
    "audio-service/app/config.py": (
        audio_config,
        [
            'Path("/opt/bmo/models/hf-cache")',
            'Path("/opt/bmo/models/torch-cache")',
            'Path("/opt/bmo/models/MODEL_MANIFEST.md")',
            'Path("/opt/bmo/models/runtime")',
            'whisper_model: str = "medium"',
            'Literal["Systran/faster-whisper-medium"]',
            'Literal["08e178d48790749d25932bbc082711ddcfdfbc4f"]',
            'whisper_hotwords: str | None = "BMO"',
            'Literal["hexgrad/Kokoro-82M"]',
            'Literal["f3ff3571791e39611d31c381e3a41a3af07b4987"]',
            "kokoro_speed: float = Field(default=0.80, gt=0)",
            "rvc_model_path: Path | None = None",
        ],
    ),
    "audio-service/scripts/bootstrap_whisper.py": (
        active_source_text[root / "audio-service" / "scripts" / "bootstrap_whisper.py"],
        ['DEFAULT_MODELS_DIR = Path("/opt/bmo/models")'],
    ),
    "audio-service/scripts/bootstrap_rvc.py": (
        active_source_text[root / "audio-service" / "scripts" / "bootstrap_rvc.py"],
        [
            'DEFAULT_MODELS_DIR = Path("/opt/bmo/models")',
            "rvc_dir = args.models_dir / RVC_RELATIVE_DIR",
        ],
    ),
}
for label, (text, required_values) in runtime_source_requirements.items():
    for value in required_values:
        if value not in text:
            errors.append(f"{label} missing runtime default: {value}")

voice_runtime_text = "\n".join(
    text
    for path, text in active_source_text.items()
    if (
        (
            (root / "backend" / "src") in path.parents
            and not (
                p9_stage == "P9.1-isolated-candidate"
                and (
                    (root / "backend" / "src" / "p9") in path.parents
                    or (root / "backend" / "src" / "generated" / "prisma") in path.parents
                )
            )
        )
        or (root / "audio-service" / "app") in path.parents
    )
)
if re.search(r"\b(POSTGRES|DATABASE_URL|PRISMA)\b", voice_runtime_text, re.IGNORECASE):
    errors.append("PostgreSQL/Prisma leaked into active voice runtime source before P9")


def parse_env_example(path: Path) -> dict[str, str]:
    text = read_utf8(path)
    values: dict[str, str] = {}
    for number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            errors.append(f"malformed env example line {path.name}:{number}")
            continue
        key, value = line.split("=", 1)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            errors.append(f"invalid env key {path.name}:{number}: {key}")
            continue
        if key in values:
            errors.append(f"duplicate env key {path.name}: {key}")
        values[key] = value
    return values


backend_env = parse_env_example(root / ".env.backend.example")
audio_env = parse_env_example(root / ".env.audio.example")
postgres_env = parse_env_example(root / ".env.postgres.example")

required_backend_env = {
    "NODE_ENV": "production",
    "BACKEND_HOST": "127.0.0.1",
    "BACKEND_PORT": "3000",
    "PUBLIC_BASE_URL": "https://api.personalbmo.web.id",
    "DEVICE_ID": "bmo-001",
    "AUDIO_SERVICE_URL": "http://127.0.0.1:8001",
    "TEMP_AUDIO_DIR": "/opt/bmo/temp/audio",
    "TEMP_AUDIO_TTL_SECONDS": "300",
    "TEMP_AUDIO_CLEANUP_INTERVAL_SECONDS": "30",
    "REQUEST_TOMBSTONE_TTL_SECONDS": "600",
    "AUDIO_SERVICE_STT_TIMEOUT_MS": "90000",
    "AUDIO_SERVICE_TTS_TIMEOUT_MS": "180000",
    "HERMES_SOFT_TIMEOUT_MS": "30000",
    "HERMES_HARD_TIMEOUT_MS": "180000",
    "READINESS_PROBE_TIMEOUT_MS": "2000",
    "TOTAL_PIPELINE_TIMEOUT_MS": "300000",
    "HARDWARE_TEST_MODE": "false",
    "WS_AUTH_TIMEOUT_MS": "5000",
    "WS_HEARTBEAT_INTERVAL_MS": "60000",
}
for key, value in required_backend_env.items():
    if backend_env.get(key) != value:
        errors.append(f".env.backend.example invalid {key}: expected {value}")
for key in ["DEVICE_TOKEN", "HERMES_API_KEY", "INTERNAL_SERVICE_TOKEN"]:
    value = backend_env.get(key, "")
    if not (value.startswith("<") and value.endswith(">")):
        errors.append(f".env.backend.example {key} must be a placeholder")
for key in ["HERMES_API_URL", "HERMES_MODEL", "HERMES_CONVERSATION"]:
    if not backend_env.get(key):
        errors.append(f".env.backend.example missing {key}")
if "DATABASE_URL" in backend_env:
    errors.append(".env.backend.example must not make voice backend depend on PostgreSQL")
if backend_env.get("HARDWARE_TEST_MODE") == "false" and "HARDWARE_TEST_MP3_PATH" in backend_env:
    errors.append(
        ".env.backend.example must omit HARDWARE_TEST_MP3_PATH when hardware test mode is disabled",
    )

required_audio_env = {
    "INTERNAL_SERVICE_TOKEN": backend_env.get("INTERNAL_SERVICE_TOKEN", ""),
    "HF_HOME": "/opt/bmo/cache/audio/huggingface",
    "TORCH_HOME": "/opt/bmo/cache/audio/torch",
    "RUNTIME_MODELS_ROOT": "/opt/bmo/models/runtime",
    "XDG_CACHE_HOME": "/opt/bmo/cache/audio/xdg",
    "MODEL_DOWNLOAD_ALLOWED": "false",
    "MODEL_MANIFEST_PATH": "/opt/bmo/models/runtime/MODEL_MANIFEST.json",
    "WHISPER_MODEL": "medium",
    "WHISPER_MODEL_REPO": "Systran/faster-whisper-medium",
    "WHISPER_MODEL_REVISION": "08e178d48790749d25932bbc082711ddcfdfbc4f",
    "WHISPER_DEVICE": "cpu",
    "WHISPER_COMPUTE_TYPE": "int8",
    "WHISPER_CPU_THREADS": "4",
    "WHISPER_WORKERS": "1",
    "WHISPER_BEAM_SIZE": "5",
    "WHISPER_VAD": "true",
    "WHISPER_HOTWORDS": "BMO",
    "KOKORO_LANG_CODE": "a",
    "KOKORO_VOICE": "af_heart",
    "KOKORO_MODEL_REPO": "hexgrad/Kokoro-82M",
    "KOKORO_MODEL_REVISION": "f3ff3571791e39611d31c381e3a41a3af07b4987",
    "KOKORO_SPEED": "0.80",
    "KOKORO_SAMPLE_RATE": "24000",
    "TTS_TEMP_DIR": "/opt/bmo/temp/tts",
    "RVC_ENABLED": "false",
    "RVC_MODEL_PATH": "<actual-path-to-be-resolved>",
    "RVC_INDEX_PATH": "",
    "OUTPUT_MP3_SAMPLE_RATE": "24000",
    "OUTPUT_MP3_BITRATE": "96k",
}
for key, value in required_audio_env.items():
    if audio_env.get(key) != value:
        errors.append(f".env.audio.example invalid {key}: expected {value}")

required_postgres_env = {
    "POSTGRES_DB": "bmo",
    "POSTGRES_USER": "bmo",
}
for key, value in required_postgres_env.items():
    if postgres_env.get(key) != value:
        errors.append(f".env.postgres.example invalid {key}: expected {value}")
postgres_password = postgres_env.get("POSTGRES_PASSWORD", "")
if not (postgres_password.startswith("<") and postgres_password.endswith(">")):
    errors.append(".env.postgres.example POSTGRES_PASSWORD must be a placeholder")

gitignore = read_utf8(root / ".gitignore")
required_ignore_rules = [
    ".env",
    ".env.*",
    "!*.example",
    "node_modules/",
    ".venv/",
    "__pycache__/",
    "*.py[cod]",
    "*.pth",
    "*.pt",
    "*.safetensors",
    "*.index",
    "*.mp3",
    "*.wav",
    "dist/",
    "build/",
    "*.bak",
    ".worktrees/",
    ".codex/",
    "GPT_PUSH_REVIEW_CONTEXT.md",
]
gitignore_rules = {
    line.strip()
    for line in gitignore.splitlines()
    if line.strip() and not line.lstrip().startswith("#")
}
for rule in required_ignore_rules:
    if rule not in gitignore_rules:
        errors.append(f".gitignore missing rule: {rule}")
if (root / "GPT_PUSH_REVIEW_CONTEXT.md").exists():
    errors.append("temporary GPT_PUSH_REVIEW_CONTEXT.md must not be tracked in production repo")

if errors:
    print("FAIL")
    for error in errors:
        print("-", error)
    sys.exit(1)

print("PASS")
print(
    f"Verified {len(expected)} backend package files, immutable reference hashes, traceability §1–§33, "
    "P1–P10 phase/dependency model, bootstrap chain, runtime defaults, env templates, "
    "active UTF-8/path hygiene, locked hardware contract, P7 VERIFIED production state, "
    "and the P7-to-P8 phase gate."
)

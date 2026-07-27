#!/usr/bin/env python3
from pathlib import Path
import hashlib
import re
import sys

root = Path(__file__).resolve().parents[1]
docs = root / "docs"
bm = root / "docs" / "backend-mvp"
hw_copy = root / "docs" / "hardware-contract" / "BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md"
prd = root / "docs" / "product" / "BMO-BY-BLABS-PRD-v1.2.4.md"
archive = root / "docs" / "archive" / "BMO-MVP-BACKEND-IMPLEMENTATION-FOR-HERMES-v1.0.5.md"

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
    "REQUIREMENT-TRACEABILITY.md",
    "VERIFICATION-REPORT.md",
    "CHANGELOG.md",
]

source_hashes = {
    prd: "fa76871f90918805e057b4f5e4841c4fbf42c0eca79e59c8c2b35c5edad191a3",
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
control_state = [
    "Documentation package: AUDITED / HARDWARE HANDOFF ADDED",
    "Current next implementation phase: P6 — VPS Foundation and Operations Baseline",
    "P6 state: READY",
    (
        "P6 execution authorization: requires an explicit user command to execute/continue "
        "the next phase; documentation alone does not start host changes"
    ),
    "P7–P10: PLANNED / dependency-gated",
]
for value in control_state:
    if value not in status:
        errors.append(f"status missing current control state: {value}")

phase_rows = {}
for line in status.splitlines():
    if not re.match(r"^\| P(?:[1-9]|10) \|", line):
        continue
    columns = [column.strip() for column in line.strip().strip("|").split("|")]
    if len(columns) != 6:
        errors.append(f"malformed implementation phase row: {line}")
        continue
    phase, _scope, _required_docs, phase_status, authorization, _evidence = columns
    if phase in phase_rows:
        errors.append(f"duplicate implementation phase row: {phase}")
    phase_rows[phase] = (phase_status, authorization)

expected_phase_rows = {
    "P1": ("VERIFIED — BACKEND", "AUTHORIZED BY USER"),
    "P2": ("VERIFIED — LOCAL FUNCTIONAL", "AUTHORIZED BY USER"),
    "P3": ("IMPLEMENTED — not VERIFIED", "AUTHORIZED BY USER"),
    "P4": ("VERIFIED — LOCAL FUNCTIONAL", "AUTHORIZED BY USER"),
    "P5": ("VERIFIED — BACKEND", "AUTHORIZED BY USER"),
    "P6": ("READY", "AWAITING EXPLICIT EXECUTION COMMAND"),
    "P7": ("NOT_STARTED", "DEPENDS ON P6 VERIFIED"),
    "P8": ("NOT_STARTED", "DEPENDS ON P7 VERIFIED"),
    "P9": (
        "NOT_STARTED",
        "DEPENDS ON P8 COMPLETED/VERIFIED STATUS; EXECUTE AFTER P8",
    ),
    "P10": (
        "NOT_STARTED",
        "DEPENDS ON P9 VERIFIED; ALSO REQUIRES P7 PUBLIC ENDPOINT + P8 STATUS",
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

p10_rows = [line for line in status.splitlines() if line.startswith("| P10 |")]
if len(p10_rows) != 1 or "physical ESP32 acceptance" not in p10_rows[0]:
    errors.append("P10 must remain final hardware integration/acceptance")

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
    "docs/roadmap/P6-EXECUTION-SPEC.md",
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
roadmap = active_doc_text[docs / "roadmap" / "P6-P10-ROADMAP.md"]
runtime_config = active_doc_text[bm / "CURRENT-RUNTIME-CONFIG.md"]
deployment_doc = active_doc_text[bm / "06-DEPLOYMENT-AND-OPERATIONS.md"]

current_doc_requirements = {
    "docs/README.md": (
        docs_readme,
        [
            "NEXT-ACTION.md",
            "roadmap/P6-EXECUTION-SPEC.md",
            "product/BMO-BY-BLABS-PRD-v1.2.4.md",
        ],
    ),
    "docs/NEXT-ACTION.md": (
        next_action,
        [
            "Current next phase:",
            "P6 — VPS Foundation and Operations Baseline",
            "Phase state:** `READY`",
            "The next implementation task is **P6 only**.",
            "Do not auto-run P7",
        ],
    ),
    "docs/roadmap/P6-EXECUTION-SPEC.md": (
        p6_spec,
        [
            "Status:** `READY`",
            "Next phase after verification:** P7",
            "P6 does **not** build/start the BMO backend/audio application",
        ],
    ),
    "docs/roadmap/P6-P10-ROADMAP.md": (
        roadmap,
        [
            "P6 → P7 → P8 → P9 → P10",
            "P7 — Deploy Backend + Audio Service + Hermes Integration",
            "P8 — Real RVC Verification and Voice Resource Benchmark",
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
            "Real RVC remains a separate verification gate.",
        ],
    ),
    "docs/backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md": (
        deployment_doc,
        [
            "/opt/bmo/",
            "RVC_MODEL_PATH=/opt/bmo/models/rvc/bmo/<actual-model-file>.pth",
            "Voice MVP P7 must run without PostgreSQL.",
        ],
    ),
}
for label, (text, required_values) in current_doc_requirements.items():
    for value in required_values:
        if value not in text:
            errors.append(f"{label} missing current-state assertion: {value}")

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
            'whisper_model: str = "medium"',
            'whisper_hotwords: str | None = "BMO"',
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
    if (root / "backend" / "src") in path.parents
    or (root / "audio-service" / "app") in path.parents
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
    "BACKEND_HOST": "0.0.0.0",
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
    "TOTAL_PIPELINE_TIMEOUT_MS": "300000",
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

required_audio_env = {
    "INTERNAL_SERVICE_TOKEN": backend_env.get("INTERNAL_SERVICE_TOKEN", ""),
    "WHISPER_MODEL": "medium",
    "WHISPER_DEVICE": "cpu",
    "WHISPER_COMPUTE_TYPE": "int8",
    "WHISPER_CPU_THREADS": "4",
    "WHISPER_WORKERS": "1",
    "WHISPER_BEAM_SIZE": "5",
    "WHISPER_VAD": "true",
    "WHISPER_HOTWORDS": "BMO",
    "KOKORO_LANG_CODE": "a",
    "KOKORO_VOICE": "af_heart",
    "KOKORO_SPEED": "0.80",
    "RVC_ENABLED": "true",
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
    "Verified 12 backend package files, immutable reference hashes, traceability §1–§33, "
    "P1–P10 phase/dependency model, bootstrap chain, runtime defaults, env templates, "
    "active UTF-8/path hygiene, locked hardware contract, and P6 authorization gate."
)

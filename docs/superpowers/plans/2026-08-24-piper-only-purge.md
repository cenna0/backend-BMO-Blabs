# BMO Piper-Only Audio Cleanup Implementation Plan

> **HISTORICAL ONLY — COMPLETED 2025-08-25**
> This plan has been executed with production evidence in `docs/operations/2026-08-24-piper-only-purge-evidence.md`. Unchecked boxes below describe the original task checklist; do not treat them as pending production work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`-`) syntax for tracking.

**Goal:** Remove active Kokoro/RVC runtime semantics and migrate BMO production to a verified faster-whisper → Hermes → Piper → FFmpeg → MP3 pipeline with memory-gated candidate promotion.

**Architecture:** Modify the existing `audio-service` implementation in place so its TTS orchestrator has only Piper and FFmpeg. Build an immutable candidate image, run it on port 8002 with read-only Whisper/Piper mounts, route a candidate backend and fake ESP to that port, then promote the candidate digest while retaining the old production image for deterministic rollback. Purge model/cache/archive artifacts only after post-promotion verification.

**Tech Stack:** Python 3.10, FastAPI, faster-whisper, Piper, FFmpeg, pytest, TypeScript/Node 22, Vitest, Docker Compose, Hermes, PostgreSQL, WebSocket fake ESP.

---

## Task 1: Protect the dirty workspace and capture migration evidence

**Files:**
- Read only: repository Git state, Docker runtime, `/opt/bmo/models`, `/opt/bmo/cache/audio`, `/opt/bmo/temp`
- Create later: `docs/operations/2026-08-24-piper-only-purge-evidence.md`

- [ ] **Step 1: Confirm the approved source and dirty-file boundary**

Run from `/opt/bmo/app`:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git diff --no-ext-diff
git diff --cached --no-ext-diff
git remote -v
```

Expected: branch `main`, starting SHA `06652ea...`, and only the already observed P9/Spotify/WhatsApp changes are dirty. Do not stage or edit any path in that dirty set.

- [ ] **Step 2: Capture immutable production identity and resource baseline**

Run without printing secrets:

```bash
docker inspect bmo-production-audio-1 --format 'container_image_id={{.Image}} repo_image={{.Config.Image}} compose_project={{index .Config.Labels "com.docker.compose.project"}} compose_file={{index .Config.Labels "com.docker.compose.project.config_files"}}'
docker image inspect bmo-audio@sha256:62ad9adead83d863ab2bf28a2ac75e5a116dc68bab8ff06eec81b7a0407ddb34 --format 'id={{.Id}} size={{.Size}} repo_digests={{json .RepoDigests}}'
free -h
free -b
docker ps
docker stats --no-stream
ps -eo pid,user,comm,%cpu,%mem,rss,vsz --sort=-rss | head -25
df -h /opt/bmo/app
du -sb /opt/bmo/models /opt/bmo/cache/audio /opt/bmo/temp 2>/dev/null
```

Expected: production container identity is recorded, host and audio baselines are available, and no production service is stopped.

- [ ] **Step 3: Prove candidate workloads before any stop**

Inspect only non-production state:

```bash
docker inspect bmo-p9-1-backend-1 bmo-p9-1-postgres-1 --format '{{.Name}} project={{index .Config.Labels "com.docker.compose.project"}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'
docker ps --filter 'name=bmo-production' --format '{{.Names}}'
docker ps --filter 'name=bmo-p9-1' --format '{{.Names}}'
```

The only permitted stop candidate is an unused non-production `bmo-p9-1` workload confirmed not to be serving an active acceptance session. Do not use `docker compose down --volumes`, delete any volume, or stop `bmo-production-*`, Hermes, or PostgreSQL production.

- [ ] **Step 4: Verify staging remains task-scoped**

Run:

```bash
git diff --cached --name-only
git status --short
```

Expected: only the approved spec commit is in history; unrelated dirty paths remain unstaged.

## Task 2: Convert Audio Service behavior with TDD before implementation

**Files:**
- Modify: `audio-service/tests/test_tts.py`
- Modify: `audio-service/tests/test_tts_api.py`
- Modify: `audio-service/tests/test_health_and_auth.py`
- Modify: `audio-service/tests/test_stt_api.py`
- Modify: `audio-service/app/tts.py`
- Modify: `audio-service/app/main.py`
- Modify: `audio-service/app/schemas.py`
- Modify: `audio-service/app/piper_tts.py`
- Delete after the failing tests are in place: `audio-service/app/kokoro_tts.py`, `audio-service/app/rvc.py`

- [ ] **Step 1: Write the failing Piper-only unit contract**

Update `audio-service/tests/test_tts.py` so the orchestrator is constructed with only `piper=` and `ffmpeg=` and asserts:

```python
def test_piper_failure_returns_tts_failed_without_fallback_or_ffmpeg(tmp_path):
    piper = FailingPiper()
    ffmpeg = RecordingFfmpeg()
    orchestrator = TtsOrchestrator(settings=settings(tmp_path), piper=piper, ffmpeg=ffmpeg)

    with pytest.raises(TtsSynthesisError, match="TTS_FAILED"):
        orchestrator.synthesize("BMO is ready")

    assert piper.calls == ["BMO is ready"]
    assert ffmpeg.calls == []
```

Add a success assertion that the result engine is exactly `"piper"`, `fallback_used` is false or absent, and the returned bytes are non-empty MP3 data. Add an FFmpeg failure assertion that also raises `TTS_FAILED`.

- [ ] **Step 2: Verify the behavior tests fail for the current implementation**

Run:

```bash
cd audio-service
python3 -m pytest tests/test_tts.py -q
```

Expected: failure because the current orchestrator requires Kokoro, accepts `use_rvc`, and falls back to Kokoro when Piper fails. Fix test setup errors until the failure is specifically the missing Piper-only behavior.

- [ ] **Step 3: Write failing API and readiness assertions**

Update `test_tts_api.py` and `test_health_and_auth.py` to assert:

```python
response = client.post(
    "/tts/synthesize",
    json={"request_id": str(uuid4()), "text": "BMO is ready"},
    headers=auth,
)
assert response.headers["x-tts-engine"] == "piper"
assert "x-rvc-applied" not in response.headers

assert client.get("/livez").json() == {"status": "ok"}
assert client.get("/health").json() == {"status": "ok"}
assert client.get("/readyz").json() == {
    "status": "ok",
    "stt_loaded": True,
    "piper_loaded": True,
    "ffmpeg_available": True,
}
```

Add a readiness failure case where only `piper_loaded` is false and assert HTTP 503. Add a test that `/health` remains process-level and does not report Kokoro/RVC fields.

- [ ] **Step 4: Run the API tests red**

Run:

```bash
python3 -m pytest tests/test_tts_api.py tests/test_health_and_auth.py -q
```

Expected: failure on old Kokoro/RVC fields and old readiness semantics.

- [ ] **Step 5: Implement the minimal Piper-only orchestrator**

In `audio-service/app/tts.py`:

```python
@dataclass(frozen=True)
class TtsEngineState:
    ffmpeg_available: bool
    piper_loaded: bool

@dataclass(frozen=True)
class TtsResult:
    audio: bytes
    engine: str
    ffmpeg_seconds: float
    piper_seconds: float

class TtsSynthesizer(Protocol):
    def health_state(self) -> TtsEngineState: ...
    def synthesize(self, text: str) -> TtsResult: ...

class TtsOrchestrator:
    def __init__(self, *, settings: Settings, piper: PiperAdapter, ffmpeg: FfmpegAdapter) -> None:
        self._settings = settings
        self._piper = piper
        self._ffmpeg = ffmpeg
        self._warmup_failed = False
        self._synthesis_lock = RLock()
```

The `synthesize` method must call Piper once, then FFmpeg once, read the MP3, and wrap every non-validation failure as `TTS_FAILED`. It must never import, instantiate, or mention a fallback engine. Update `PiperSynthesisError` documentation so it describes a terminal Piper failure.

- [ ] **Step 6: Implement the liveness/readiness split and remove HTTP RVC fields**

In `audio-service/app/main.py`:

- construct `TtsOrchestrator(settings=..., piper=PiperSynthesizer(...), ffmpeg=FfmpegConverter(...))`;
- warm only faster-whisper and the Piper/FFmpeg orchestrator;
- make `/livez` return `{"status": "ok"}` without model state;
- make `/health` return the same process-level liveness payload;
- make `/readyz` return dependency fields and HTTP 503 unless all three booleans are true;
- call `synthesize(text)` without `payload.use_rvc`;
- emit only `X-TTS-Engine: piper` on successful TTS responses.

In `audio-service/app/schemas.py`, remove `use_rvc` from `TtsRequest`, remove `kokoro_loaded`/`rvc_available` from `HealthResponse`, and add `piper_loaded`.

- [ ] **Step 7: Run audio contract tests green and compile the service**

Run:

```bash
python3 -m pytest tests/test_tts.py tests/test_tts_api.py tests/test_health_and_auth.py tests/test_stt_api.py -q
python3 -m compileall app tests scripts
```

Expected: all selected tests pass and compileall exits 0.

## Task 3: Remove Kokoro/RVC source, model bootstrap, and packaging semantics

**Files:**
- Modify: `audio-service/app/config.py`
- Modify: `audio-service/app/model_assets.py`
- Modify: `audio-service/scripts/bootstrap_models.py`
- Modify: `audio-service/scripts/bootstrap_whisper.py`
- Modify: `audio-service/MODEL_MANIFEST.md`
- Modify: `audio-service/Dockerfile`
- Modify: `audio-service/requirements.txt`
- Modify: `audio-service/requirements-runtime.lock`
- Modify: `audio-service/requirements-verify.txt`
- Modify: `audio-service/.dockerignore`
- Modify: `.env.audio.example`
- Modify: `docker-compose.yml`
- Modify: `audio-service/tests/test_config.py`
- Modify: `audio-service/tests/test_model_assets.py`
- Modify: `audio-service/tests/test_bootstrap_models.py`
- Modify: `audio-service/tests/test_offline_models.py`
- Modify: `audio-service/tests/test_piper_packaging.py`
- Delete: `audio-service/scripts/bootstrap_rvc.py`
- Delete: `audio-service/tests/test_kokoro_tts.py`
- Delete: `audio-service/tests/test_rvc.py`
- Delete: `audio-service/tests/test_rvc_bootstrap.py`

- [ ] **Step 1: Write failing single-model bootstrap assertions**

Update model/bootstrap tests so `MODEL_SPECS` has exactly `whisper`, the generated manifest contains only `WHISPER_SPEC`, and no settings object accepts or exposes `KOKORO_*`, `TTS_FALLBACK_ENGINE`, or `RVC_*`. Update packaging tests to require no Kokoro/RVC environment keys, mounts, or bootstrap files.

Run:

```bash
cd audio-service
python3 -m pytest tests/test_config.py tests/test_model_assets.py tests/test_bootstrap_models.py tests/test_offline_models.py tests/test_piper_packaging.py -q
```

Expected: failures against the current two-model bootstrap and settings.

- [ ] **Step 2: Audit all dependency consumers before editing lockfiles**

Run:

```bash
rg -n -i 'kokoro|misaki|spacy|torch|torchaudio|phonemizer|espeak|transformers|soundfile|subprocess|Popen|run\\(' audio-service Dockerfile* audio-service/Dockerfile audio-service/app audio-service/scripts audio-service/tests requirements* .env* docker-compose.yml
docker run --rm bmo-audio@sha256:62ad9adead83d863ab2bf28a2ac75e5a116dc68bab8ff06eec81b7a0407ddb34 python -m pip freeze
docker run --rm bmo-audio@sha256:62ad9adead83d863ab2bf28a2ac75e5a116dc68bab8ff06eec81b7a0407ddb34 sh -lc 'command -v ffmpeg; command -v ffprobe; command -v espeak-ng || true; python - <<"PY"
import importlib.util
for name in ("faster_whisper", "piper", "onnxruntime", "torch", "kokoro", "spacy", "transformers"):
    print(name, bool(importlib.util.find_spec(name)))
PY'
```

Classify each candidate dependency across Python imports, Piper subprocess/worker behavior, faster-whisper runtime, Docker apt packages, and bootstrap-only code. Remove only packages and system layers proved exclusive to Kokoro/RVC. Keep `faster-whisper`, `piper-tts`, `onnxruntime`, FFmpeg, `libgomp1`, and any package still required by their runtime paths.

- [ ] **Step 3: Make settings and model bootstrap Whisper/Piper-only**

In `config.py`, remove all Kokoro and RVC fields, `torch_home` if the dependency audit proves no remaining consumer needs it, and `tts_fallback_engine`. Keep fixed Piper asset settings and Whisper runtime settings.

In `model_assets.py` and `bootstrap_models.py`, remove `KOKORO_SPEC`, make the CLI choices Whisper-only, and generate a manifest containing only the pinned faster-whisper snapshot. Keep the Piper asset manifest separate.

- [ ] **Step 4: Remove obsolete Docker/env/bootstrap layers**

In `audio-service/Dockerfile`, remove the Kokoro-only `spacy` model install/check and retain only required runtime packages and the `/livez` healthcheck. In `.env.audio.example` and `docker-compose.yml`, remove `KOKORO_*`, `TTS_FALLBACK_ENGINE`, `RVC_*`, and any Kokoro/RVC model/cache mounts. Do not remove shared Whisper/Piper mounts or FFmpeg.

- [ ] **Step 5: Run model/config/packaging tests green**

Run:

```bash
cd audio-service
python3 -m pytest tests/test_config.py tests/test_model_assets.py tests/test_bootstrap_models.py tests/test_offline_models.py tests/test_piper_packaging.py -q
python3 -m compileall app tests scripts
```

Expected: selected tests pass with no Kokoro/RVC implementation files required.

- [ ] **Step 6: Remove source-level Kokoro/RVC files after tests are green**

Delete `audio-service/app/kokoro_tts.py`, `audio-service/app/rvc.py`, `audio-service/scripts/bootstrap_rvc.py`, and their dedicated tests. Run:

```bash
rg -n -i 'kokoro|rvc|use_rvc|rvc_applied|rvc_available|kokoro_loaded|TTS_FALLBACK_ENGINE|KOKORO_|RVC_' audio-service --glob '!*.pyc' --glob '!.pytest_cache/**'
```

Expected: no runtime implementation reference remains; documentation/contract fallout is handled by Tasks 4 and 5.

## Task 4: Remove RVC/Kokoro backend contract semantics with TDD

**Files:**
- Modify: `backend/src/services/audio-service.client.ts`
- Modify: `backend/src/services/voice-pipeline.service.ts`
- Modify: `backend/src/services/readiness.service.ts`
- Modify: `backend/src/http/health.route.ts`
- Modify: `backend/tests/audio-service-client.test.ts`
- Modify: `backend/tests/voice-pipeline.test.ts`
- Modify: `backend/tests/p5-failure-mapping.test.ts`
- Modify: `backend/tests/p5-security.test.ts`
- Modify: `backend/tests/readiness-service.test.ts`
- Modify: `backend/tests/health.integration.test.ts`
- Modify: `backend/tests/voice.integration.test.ts`
- Modify: `backend/tests/verify-p7-public-e2e.test.ts`
- Modify: `backend/tests/env.test.ts` only if candidate URL override needs coverage

- [ ] **Step 1: Write failing client/pipeline contract tests**

Update `backend/tests/audio-service-client.test.ts` so the request body is exactly `{ request_id, text }`, the response parser retains audio and `ttsEngine: "piper"`, and `x-rvc-applied` is not read. Update pipeline fixtures to remove `rvcApplied` and use `synthesize(requestId, text, signal)`.

- [ ] **Step 2: Run the backend contract tests red**

Run:

```bash
cd backend
npm test -- --runInBand tests/audio-service-client.test.ts tests/voice-pipeline.test.ts tests/p5-failure-mapping.test.ts tests/p5-security.test.ts
```

Expected: failures because the current client sends `use_rvc`, parses RVC headers, and requires `rvcApplied`.

- [ ] **Step 3: Implement the client and pipeline contract**

Change `AudioServicePort.synthesize` to:

```typescript
synthesize(requestId: string, text: string, signal?: AbortSignal): Promise<TtsResult>;
```

Send only `request_id` and `text`. Keep `x-tts-engine` parsing as optional observability defaulting to `"piper"`; never parse or emit an RVC header. Remove `rvcApplied` from types, logs, and return values. Update the pipeline call to `synthesize(record.requestId, responseText, signal)`.

- [ ] **Step 4: Write and run failing readiness tests**

Update `backend/tests/readiness-service.test.ts` to mock:

```json
{"status":"ok","stt_loaded":true,"piper_loaded":true,"ffmpeg_available":true}
```

and assert `{ hermesReady: true, audioReady: true }` with no `rvcAvailable`. Add a `piper_loaded: false` case. Update health integration assertions to remove public `rvc`.

Run:

```bash
npm test -- --runInBand tests/readiness-service.test.ts tests/health.integration.test.ts
```

Expected: failures against the current readiness parser and public health payload.

- [ ] **Step 5: Implement backend readiness and health changes**

In `readiness.service.ts`, make `AudioReadiness` contain only `ready`, fetch `/readyz`, and require `status === "ok"`, `stt_loaded === true`, `piper_loaded === true`, and `ffmpeg_available === true`. Remove `rvcAvailable` from `BackendReadinessState`.

In `health.route.ts` and its tests, remove the `rvc` response field and preserve backend, Hermes, audio, and database statuses. Do not change PostgreSQL or Hermes probes.

- [ ] **Step 6: Run all backend tests and typecheck**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: zero test failures, zero TypeScript errors, and a successful build. Fix only audio-contract fallout; do not modify dirty P9/Spotify/WhatsApp files.

## Task 5: Remove historical candidate Kokoro/RVC code and define candidate routing

**Files:**
- Modify: `audio-service/scripts/verify_voice_pipeline.py`
- Modify: `piper-candidate/bmo_piper/shutdown_suite.py`
- Modify: `piper-candidate/bmo_piper/host_snapshot.py`
- Modify: `piper-candidate/tests/test_packaging.py`
- Modify: `piper-candidate/tests/test_host_snapshot.py`
- Delete: `piper-candidate/bmo_piper/kokoro_reference.py`
- Delete: `piper-candidate/tests/test_kokoro_reference.py`
- Delete: `piper-candidate/bmo_piper/bundle.py` if its only consumers are Kokoro/RVC comparison tooling
- Delete: `piper-candidate/comparison-text.json` if it is used only by the deleted comparison bundle
- Create: `ops/deploy/piper-only-candidate-compose.yml`
- Modify: `p9.1-compose.yml` only to allow candidate backend audio URL override
- Create: `tests/packaging/test_piper_only_candidate_packaging.py`

- [ ] **Step 1: Replace the old real-inference verifier with Piper-only checks**

Rewrite `audio-service/scripts/verify_voice_pipeline.py` to accept a base URL and internal token, call candidate `/livez`, `/health`, `/readyz`, `/stt/transcribe`, and `/tts/synthesize`, then use `ffprobe` to require MP3, mono, 24 kHz, and 96 kbps. It must not import `app.kokoro_tts`, `app.rvc`, or construct a local production app. Its result JSON must identify the candidate URL, image identity supplied by the caller, STT result, Piper engine header, FFmpeg probe, and pass/fail status.

- [ ] **Step 2: Run verifier/package tests red**

Run:

```bash
python3 -m pytest audio-service/tests -q
python3 -m pytest piper-candidate/tests -q
```

Expected: failures from old Kokoro/RVC imports and candidate package assertions.

- [ ] **Step 3: Remove Kokoro/RVC-only candidate harness code**

Retain Piper-only process, shutdown, benchmark, and host-monitor checks. Remove Kokoro comparison/bundle/reference behavior and remove `rvc_enabled` from host snapshots. If `bundle.py` has no Piper-only consumer, delete it rather than retaining a comparison tool whose output implies a production Kokoro baseline.

- [ ] **Step 4: Add a candidate Compose overlay with explicit port and mounts**

Create `ops/deploy/piper-only-candidate-compose.yml` with an `audio` service that:

- uses `${AUDIO_CANDIDATE_IMAGE}`;
- binds `127.0.0.1:8002:8002`;
- overrides Uvicorn to port 8002;
- mounts `/opt/bmo/models/runtime` and `/opt/bmo/models/piper` read-only;
- mounts a candidate TTS temp directory separately from production;
- mounts any cache read-only and sets offline/download-disabled values;
- contains no Kokoro/RVC environment key or model path.

Override candidate backend with `AUDIO_SERVICE_URL: http://127.0.0.1:8002` and keep candidate backend port 3010. The overlay must not change production Compose or production ports.

- [ ] **Step 5: Add static candidate topology tests**

In `tests/packaging/test_piper_only_candidate_packaging.py`, assert the overlay contains `8002`, `read_only: true`, both model mounts, `MODEL_DOWNLOAD_ALLOWED: "false"`, and `AUDIO_SERVICE_URL: http://127.0.0.1:8002`; assert it contains no case-insensitive Kokoro/RVC token. Assert production Compose still targets port 8001 and contains no candidate service.

- [ ] **Step 6: Run candidate packaging tests green**

Run:

```bash
python3 -m pytest tests/packaging/test_piper_only_candidate_packaging.py tests/packaging/test_p9_candidate_packaging.py tests/packaging/test_p9_production_packaging.py -q
python3 -m pytest audio-service/tests piper-candidate/tests -q
```

Expected: all packaging and audio/candidate unit tests pass with no active Kokoro/RVC source/test references.

## Task 6: Build and inspect the clean candidate image

**Files:**
- Modify only if clean build exposes a packaging defect: `audio-service/Dockerfile`, `audio-service/requirements-runtime.lock`
- Evidence later: `docs/operations/2026-08-24-piper-only-purge-evidence.md`

- [ ] **Step 1: Run complete local verification before building**

Run:

```bash
cd audio-service
python3 -m pytest -q
python3 -m compileall app tests scripts
python3 -m pip check
cd ../backend
npm test
npm run typecheck
npm run build
```

Expected: all tests pass, compileall exits 0, pip check reports no broken requirements, and the backend builds.

- [ ] **Step 2: Build from a clean task source**

Use the committed task source rather than dirty P9/Spotify/WhatsApp files for the backend candidate build. Create a temporary detached worktree from the task commit, verify its status is empty, and use it only as the candidate build context. The primary worktree remains untouched except for task files.

Build the audio candidate with no cache:

```bash
docker build --no-cache --build-arg VCS_REF="$(git rev-parse HEAD)" -t bmo-audio:piper-only-candidate-$(git rev-parse --short HEAD) audio-service
```

Expected: exit 0 and no model download step. Record tag, image ID, repo digest if available, and image size.

- [ ] **Step 3: Prove runtime and subprocess dependency hygiene**

Run against the candidate image without host model mounts:

```bash
docker run --rm --network none bmo-audio:piper-only-candidate-$(git rev-parse --short HEAD) python - <<'PY'
import importlib.util
for name in ("faster_whisper", "piper", "onnxruntime"):
    assert importlib.util.find_spec(name), name
for name in ("kokoro", "spacy", "torch", "transformers"):
    assert importlib.util.find_spec(name) is None, name
PY
docker run --rm --network none bmo-audio:piper-only-candidate-$(git rev-parse --short HEAD) sh -lc 'command -v ffmpeg && command -v ffprobe && ! command -v rvc'
```

Expected: required STT/Piper/FFmpeg tools exist, obsolete packages/tools are absent, and the process has no network path.

- [ ] **Step 4: Build the candidate backend image from the clean worktree**

Build candidate backend with its immutable source SHA and render the base Compose plus overlay. Do not use the dirty primary worktree as the backend build context. Expected: candidate backend image builds, rendered candidate traffic routes to 8002, and production Compose remains unchanged.

## Task 7: Run memory-gated candidate verification

**Files:**
- Create/update only evidence: `docs/operations/2026-08-24-piper-only-purge-evidence.md`
- Runtime targets: non-production candidate containers only

- [ ] **Step 1: Capture the exact pre-start memory gate**

Immediately before starting candidate audio, run and record:

```bash
date --iso-8601=seconds
free -h
free -b
docker stats --no-stream
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
```

If `MemAvailable` is below `4294967296`, do not start candidate audio. Stop only a proven-unused non-production candidate workload if one exists, repeat the commands, and fail closed if the threshold is still not met.

- [ ] **Step 2: Start only candidate services after the 4 GiB gate**

Run the candidate overlay with the isolated candidate project and protected env files, passing the recorded candidate image reference. Expected: production audio remains Up, candidate audio is the only process bound to 8002, and candidate model mounts are read-only.

- [ ] **Step 3: Verify candidate liveness/readiness and immediate resource safety**

Run:

```bash
curl --fail --silent --show-error http://127.0.0.1:8002/livez
curl --fail --silent --show-error http://127.0.0.1:8002/health
curl --fail --silent --show-error http://127.0.0.1:8002/readyz
free -h
free -b
docker stats --no-stream
candidate_audio_container="$(docker ps --filter 'label=com.docker.compose.service=audio' --filter 'label=com.docker.compose.project=bmo-p9-1' --format '{{.Names}}' | head -1)"
test -n "${candidate_audio_container}"
docker inspect "${candidate_audio_container}" --format 'oom_killed={{.State.OOMKilled}} restarts={{.RestartCount}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'
```

If `/readyz` is not HTTP 200, `MemAvailable < 1.5 GiB`, `oom_killed=true`, the container restarts, health fails, or kernel/container pressure is observed, stop candidate immediately and record `BLOCKED_RESOURCE`. Do not promote or purge artifacts.

- [ ] **Step 4: Run real candidate STT, Piper, and FFmpeg verification**

Use the real WAV fixture and protected internal service token without printing it:

```bash
python3 audio-service/scripts/verify_voice_pipeline.py \
  --base-url http://127.0.0.1:8002 \
  --token-file /opt/bmo/config/audio-service.token \
  --wav audio-service/temp/real-inference-fixtures/english.wav \
  --output /tmp/bmo-piper-candidate-result.json
```

Expected: candidate STT returns speech, candidate TTS returns `X-TTS-Engine: piper`, FFmpeg reports valid mono 24 kHz MP3 at the configured bitrate, and the result identifies port 8002. If the protected token file has a different known path, use that path without printing its contents.

- [ ] **Step 5: Run full candidate backend/Hermes/fake-ESP flow**

Use candidate backend `http://127.0.0.1:3010` and candidate-only device credentials, with candidate backend environment confirmed to contain `AUDIO_SERVICE_URL=http://127.0.0.1:8002`. Run:

```bash
cd backend
BMO_BASE_URL=http://127.0.0.1:3010 \
DEVICE_ID=bmo-001 \
DEVICE_TOKEN="$(docker inspect bmo-p9-1-backend-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^DEVICE_TOKEN=//p')" \
FAKE_ESP32_WAV_PATH=../audio-service/temp/real-inference-fixtures/english.wav \
FAKE_ESP32_OUTPUT_MP3_PATH=/tmp/bmo-piper-candidate-fake-esp.mp3 \
npm run fake-esp32
```

The token is supplied by the protected candidate environment and must not be committed or printed. Expected: authenticated upload, `thinking`, `audio_ready`, `audio/mpeg`, non-empty MP3, and playback-done. Inspect candidate backend logs and candidate audio evidence to prove TTS reached port 8002; any production 8001 route is a failure.

- [ ] **Step 6: Stop candidate services after verification and retain evidence**

If all candidate checks pass, stop only candidate services before promotion unless the promotion runbook requires them. Record post-ready resource stats and all pass outputs. If any check fails, stop candidate, preserve production, and report `BLOCKED` with the first failed gate.

## Task 8: Promote with deterministic rollback and verify production

**Files:**
- Modify the out-of-repository protected production Compose env file identified by the Compose project labels, only after candidate pass
- Create/update evidence: `docs/operations/2026-08-24-piper-only-purge-evidence.md`
- Do not delete: old production image

- [ ] **Step 1: Capture old and candidate digests immediately before promotion**

Run:

```bash
old_audio_digest="$(docker inspect bmo-production-audio-1 --format '{{.Image}}')"
candidate_audio_digest="$(docker image inspect bmo-audio:piper-only-candidate-$(git rev-parse --short HEAD) --format '{{.Id}}')"
test -n "${old_audio_digest}"
test -n "${candidate_audio_digest}"
printf '%s\n' "old_audio_digest=${old_audio_digest}" "candidate_audio_digest=${candidate_audio_digest}"
```

Store exact values in evidence without exposing secrets. Refuse promotion if either digest is missing or candidate image is not the image that passed Task 7.

- [ ] **Step 2: Promote only the Audio Service image**

Update the protected production image reference to the candidate immutable reference and run production Compose for `audio` only with `--no-deps`. Do not recreate backend, Hermes, PostgreSQL, or unrelated services. Confirm the old image remains present locally.

- [ ] **Step 3: Verify post-promotion production health and real voice flow**

Run:

```bash
curl --fail --silent --show-error http://127.0.0.1:8001/livez
curl --fail --silent --show-error http://127.0.0.1:8001/health
curl --fail --silent --show-error http://127.0.0.1:8001/readyz
curl --fail --silent --show-error http://127.0.0.1:3000/livez
curl --fail --silent --show-error http://127.0.0.1:3000/readyz
curl --fail --silent --show-error http://127.0.0.1:8642/health
docker ps
docker stats --no-stream
```

Run the same real WAV → STT → Hermes → Piper → FFmpeg → MP3 → fake ESP flow against production backend `127.0.0.1:3000`. If any check fails, restore exact `old_audio_digest`, recreate only production audio, rerun health, and stop all purge work.

- [ ] **Step 4: Record post-promotion resource measurements**

Capture audio RSS, host `MemAvailable`, image sizes, and disk usage using Task 1 commands. Do not claim improvement unless both before and after values are present.

## Task 9: Purge artifacts selectively and update active documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-08-24-remove-rvc-design.md` with a deprecated supersession banner
- Modify: `docs/backend-mvp/01-SCOPE-AND-DECISIONS.md`
- Modify: `docs/backend-mvp/04-AUDIO-SERVICE.md`
- Modify: `docs/backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md`
- Modify: `docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md`
- Modify: `docs/backend-mvp/IMPLEMENTATION-STATUS.md`
- Modify: `.env.audio.example`
- Create/update: `docs/operations/2026-08-24-piper-only-purge-evidence.md`
- Runtime targets only after Task 8 pass: exact Kokoro/RVC model/cache/archive paths

- [ ] **Step 1: Prove exact artifact targets before deletion**

Run read-only inventory:

```bash
find /opt/bmo/models /opt/bmo/cache/audio /opt/bmo/temp -xdev \( -iname '*kokoro*' -o -iname '*rvc*' -o -iname '*rmvpe*' -o -iname '*hubert*' \) -print
du -sb /opt/bmo/models/runtime/kokoro-82m-af-heart /opt/bmo/models/kokoro 2>/dev/null || true
find /opt/bmo/cache/audio -xdev -type d -iname '*kokoro*' -print
find /opt/bmo -xdev -type f \( -iname '*rvc*' -o -iname '*kokoro*' \) -print
```

Require every deletion target to be Kokoro/RVC-only. Do not delete Whisper, Piper, or shared cache roots.

- [ ] **Step 2: Delete only verified obsolete model/cache/archive artifacts**

After Task 8 production readiness, delete only reviewed Kokoro/RVC directories/files using explicit paths and a recoverable operator procedure. Do not use broad `rm -rf /opt/bmo/models`, `rm -rf /opt/bmo/cache/audio`, or Docker volume/image prune. Keep the old production image until rollback-retention is verified.

- [ ] **Step 3: Rewrite active documentation and mark historical evidence**

Replace active fallback descriptions with:

```text
faster-whisper → Hermes → Piper → FFmpeg → MP3
```

Mark retained P8/RVC evidence with `DEPRECATED`, `HISTORICAL ONLY`, and `DO NOT IMPLEMENT`. Remove obsolete active env examples, readiness fields, and deployment instructions. Preserve immutable historical Git commits.

- [ ] **Step 4: Write the evidence report**

Populate `docs/operations/2026-08-24-piper-only-purge-evidence.md` with branch, starting/final SHA, remote equality, dirty-file preservation, old/candidate digests, test results, production checks, model/dependency removals, artifact sizes, resource before/after, rollback command, and limitations.

## Task 10: Clean refs and run final semantic verification

**Files:**
- Modify only task documentation/evidence and Git refs
- Do not modify unrelated dirty files

- [ ] **Step 1: Verify no active semantic matches remain**

Run excluding `.git`, generated caches, binaries, and explicitly marked historical docs:

```bash
rg -n -i --hidden --glob '!.git/**' --glob '!node_modules/**' --glob '!**/__pycache__/**' --glob '!**/.pytest_cache/**' 'kokoro|KOKORO_|rvc|RVC_|use_rvc|rvc_available|rvc_applied|rvcApplied|X-RVC-Applied|kokoro_loaded|TTS_FALLBACK_ENGINE' .
```

Manually classify every match. Active runtime/config/test/Docker/bootstrap/backend/ESP contract matches are a failure. Only clearly marked historical/deprecated docs/evidence and immutable Git history may remain.

- [ ] **Step 2: Remove verified local RVC refs without touching remote/history**

After source and production verification:

```bash
git worktree list --porcelain
git branch --list '*rvc*' -vv
git branch -r --list '*rvc*' -vv
```

Confirm `feat/p8-rvc-foundation` has no worktree and is RVC-specific, then delete only that local branch and its stale local remote-tracking ref. Do not delete remote branches, rewrite `main`, expire reflogs, or prune objects.

- [ ] **Step 3: Run the complete verification suite**

Run:

```bash
cd audio-service && python3 -m pytest -q && python3 -m compileall app tests scripts && python3 -m pip check
cd ../backend && npm test && npm run typecheck && npm run build
cd .. && python3 -m pytest tests/packaging tests/operations tests/verification -q
git diff --check
git status --short
git log -3 --oneline --decorate
```

Expected: all relevant tests pass; final status contains only unrelated pre-existing dirty files plus explicitly intended task documentation if not committed yet.

- [ ] **Step 4: Produce the required final report**

Use the exact `BMO_PIPER_ONLY_PURGE_RESULT` format from the user request. Return `PASS` only if candidate and post-promotion end-to-end verification passed with numeric resource before/after evidence. Return `BLOCKED` for any resource gate, candidate, promotion, or verification failure, naming the first failed gate and confirming production/image/model safety state.

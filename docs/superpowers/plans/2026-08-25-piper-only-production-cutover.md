# Joy Piper-Only Production Cutover and Legacy Audio Purge Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely promote the already-built Piper-only Audio Service, verify the complete Joy voice path, then remove Kokoro/RVC runtime artifacts without losing rollback capability or touching unrelated P9/Spotify/WhatsApp work.

**Architecture:** Keep the current production Audio Service alive on `127.0.0.1:8001` until an isolated Piper-only candidate passes health, real STT/TTS/FFmpeg, and candidate backend/Hermes/fake-ESP checks on `127.0.0.1:8002`. Promote only the Audio Service image, retain the old immutable image and config for rollback, then purge only reviewed Kokoro/RVC artifacts and mark legacy documentation historical.

**Tech Stack:** Docker Compose 5.3.1, immutable Docker images, Python/FastAPI Audio Service, faster-whisper, Piper, FFmpeg, Node/TypeScript backend, Hermes host runtime, PostgreSQL, fake ESP32 verifier, SHA-256 evidence.

---

## Current facts and hard decisions

- Repository: `/opt/joy/app`, branch `main`, current source `4fcd1cb`.
- Piper-only source commits already exist: `860f971` and `3415075`.
- Existing candidate images exist and must be identity-checked before use:
  - Audio: `joy-audio@sha256:24e1c4244ea8868f731d819ea75cb57c1e464b6df3bd9679d65fd4711643488c`.
  - Backend: `joy-p9.1-candidate@sha256:71011f1b2ee10852774bddd1bd03dd6ae0f7a66eea1e190e1c4981023792efe0`.
- Current production Audio Service remains `joy-audio@sha256:62ad9adead83d863ab2bf28a2ac75e5a116dc68bab8ff06eec81b7a0407ddb34`, healthy on port `8001`.
- Current host has approximately 8.3 GiB RAM, no swap, and the observed `MemAvailable` was approximately 3.14 GiB. Candidate start is forbidden below 4 GiB.
- The current production env file still contains legacy `KOKORO_*` and `RVC_ENABLED` keys. Do not remove them until the old image is no longer the active production image and rollback retention has been captured.
- Candidate Compose currently references the production `audio.env`; before candidate start, generate a temporary sanitized candidate env file. Candidate containers must receive no `KOKORO_*`, `RVC_*`, or fallback-engine keys.
- Preflight on 2026-08-25 observed production Audio restart count `15` with current health `healthy`, OOM `false`, and no lifecycle event in the inspected four-hour window; preserve this as the baseline and require no increment during rollout.
- The source tree has unrelated dirty P9/Spotify/WhatsApp changes. Do not stage, reset, clean, or edit those paths.
- No `docker compose down --volumes`, Docker prune, broad recursive deletion, force push, remote branch deletion, reflog expiry, or database rollback is allowed.

## Abort and rollback rules

- **BLOCKED_RESOURCE:** If `MemAvailable < 4 GiB` before candidate start, do not start candidate or purge anything. A user-authorized maintenance override may stop only `joy-production-audio-1` after its digest/state are recorded, solely to free memory for the isolated candidate. If the candidate fails, restore the old Audio image immediately.
- **BLOCKED_RESOURCE:** After candidate readiness, stop candidate immediately if `MemAvailable < 1.5 GiB`, OOM is observed, restart count changes, memory PSI remains pressured, or health fails.
- **BLOCKED_HEALTH:** Any failed candidate or production health/readiness check stops the rollout. Production remains on the old image unless the new image is already active; in that case restore the old digest immediately.
- **BLOCKED_CONTRACT:** Any request that sends production traffic to candidate port `8001`, exposes candidate ports publicly, contains legacy env keys in candidate config, or returns old readiness/RVC fields stops the rollout.
- **Rollback target:** restore only the recorded old Audio image and old Audio env, recreate only `joy-production-audio-1`, then rerun Audio and backend health checks. Do not recreate Backend, PostgreSQL, Hermes, Caddy, WhatsApp, or monitoring.
- **Purge boundary:** no Kokoro/RVC file, cache, image, archive, or config deletion before post-promotion full-pipeline verification passes and rollback references are recorded.

---

### Task 1: Capture preflight evidence and protect the dirty workspace

**Files:**
- Read: `/opt/joy/app` Git state, Compose labels, Docker state, resource state.
- Create: `/opt/joy/temp/piper-only-cutover-evidence/<UTC>/`.

- [ ] **Step 1: Capture repository identity without modifying files**

Run:

```bash
cd /opt/joy/app
git branch --show-current
git rev-parse HEAD
git status --short
git diff --no-ext-diff
git diff --cached --no-ext-diff
git remote -v
```

Expected: branch `main`, source `4fcd1cb` at planning time, and the existing unrelated dirty paths remain unstaged. If the dirty set changed unexpectedly, stop and record the new boundary before continuing.

- [ ] **Step 2: Capture protected production identities**

Run without printing env-file contents:

```bash
mkdir -p /opt/joy/temp/piper-only-cutover-evidence/$(date -u +%Y%m%dT%H%M%SZ)
EVIDENCE_DIR=$(printf '%s\\n' /opt/joy/temp/piper-only-cutover-evidence/* | sort | awk 'END{print}')
docker inspect joy-production-audio-1 --format 'name={{.Name}} image={{.Config.Image}} image_id={{.Image}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}' | tee "$EVIDENCE_DIR/production-audio-before.txt"
docker inspect joy-production-p9-backend-1 --format 'name={{.Name}} image={{.Config.Image}} image_id={{.Image}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}' | tee "$EVIDENCE_DIR/production-backend-before.txt"
docker inspect joy-production-p9-postgres-1 --format 'name={{.Name}} image={{.Config.Image}} image_id={{.Image}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}' | tee "$EVIDENCE_DIR/production-postgres-before.txt"
docker inspect joy-production-audio-1 --format '{{json .Config.Labels}}' > "$EVIDENCE_DIR/audio-labels.json"
```

Expected: Audio, Backend, and PostgreSQL are healthy; current Audio image ID matches `62ad9ade...`; OOM is false; record the existing restart count as the baseline and require it not to increase before the intentional Audio replacement.

- [ ] **Step 3: Capture resource and disk baselines**

Run:

```bash
{
  date --iso-8601=seconds
  free -h
  free -b
  swapon --show
  docker stats --no-stream
  docker ps --format '{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}'
  df -h /opt/joy
  du -sb /opt/joy/models /opt/joy/cache/audio /opt/joy/temp /opt/joy/archive 2>/dev/null
} | tee "$EVIDENCE_DIR/resources-before.txt"
```

Expected: `MemAvailable` is recorded numerically. The 4 GiB gate is evaluated from `free -b`, not from rounded `free -h` output.

- [ ] **Step 4: Save rollback references without exposing secrets**

Run:

```bash
install -d -m 700 "$EVIDENCE_DIR/rollback"
docker image inspect joy-audio@sha256:62ad9adead83d863ab2bf28a2ac75e5a116dc68bab8ff06eec81b7a0407ddb34 --format 'id={{.Id}} size={{.Size}} repo_digests={{json .RepoDigests}}' > "$EVIDENCE_DIR/rollback/old-audio-image.txt"
sha256sum /opt/joy/app/docker-compose.yml /opt/joy/config/audio.env > "$EVIDENCE_DIR/rollback/config-sha256.txt"
stat -c '%n mode=%a owner=%U:%G size=%s' /opt/joy/config/audio.env >> "$EVIDENCE_DIR/rollback/config-sha256.txt"
```

Copy the protected Audio env to `$EVIDENCE_DIR/rollback/audio.env` only with mode `600`; never print its contents. Keep this evidence directory until rollback retention is explicitly closed.

---

### Task 2: Verify the Piper-only source and image contract

**Files:**
- Read: `audio-service/`, `backend/`, `ops/deploy/piper-only-candidate-compose.yml`.
- Modify only if verification exposes a concrete defect; never modify unrelated dirty files.

- [ ] **Step 1: Verify the candidate image identities and source revisions**

Run:

```bash
cd /opt/joy/app
docker image inspect joy-audio@sha256:24e1c4244ea8868f731d819ea75cb57c1e464b6df3bd9679d65fd4711643488c --format 'id={{.Id}} size={{.Size}} revision={{index .Config.Labels "org.opencontainers.image.revision"}}'
docker image inspect joy-p9.1-candidate@sha256:71011f1b2ee10852774bddd1bd03dd6ae0f7a66eea1e190e1c4981023792efe0 --format 'id={{.Id}} size={{.Size}} revision={{index .Config.Labels "org.opencontainers.image.revision"}}'
git show -s --format='%H %s' 3415075
```

Expected: both images exist, the Audio image revision is the Piper-only source revision, and the Backend image is the candidate built from the same approved Piper-only source boundary. If revisions do not match, rebuild from a clean detached worktree before any runtime test.

- [ ] **Step 2: Prove obsolete runtime dependencies are absent from the Audio image**

Run:

```bash
docker run --rm --network none joy-audio@sha256:24e1c4244ea8868f731d819ea75cb57c1e464b6df3bd9679d65fd4711643488c python -c 'import importlib.util; required=("faster_whisper","piper","onnxruntime"); forbidden=("kokoro","spacy","torch","transformers"); assert all(importlib.util.find_spec(x) for x in required); assert not any(importlib.util.find_spec(x) for x in forbidden); print("dependency-contract=ok")'
docker run --rm --network none joy-audio@sha256:24e1c4244ea8868f731d819ea75cb57c1e464b6df3bd9679d65fd4711643488c sh -lc 'command -v ffmpeg && command -v ffprobe && ! command -v rvc'
```

Expected: required modules and binaries exist; Kokoro, RVC, and exclusive legacy packages/tools do not.

- [ ] **Step 3: Run source-level semantic and test verification**

Run from a clean detached worktree based on the approved Piper-only commit, not from the dirty primary checkout:

```bash
python3 -m pytest audio-service/tests -q
python3 -m compileall audio-service/app audio-service/tests audio-service/scripts
python3 -m pytest piper-candidate/tests -q
python3 -m pytest tests/packaging tests/operations tests/verification -q
cd backend
npm test
npm run typecheck
npm run build
```

Then run the semantic scan excluding Git history, generated caches, and explicitly historical/deprecated docs:

```bash
cd /opt/joy/app
rg -n -i --hidden --glob '!.git/**' --glob '!node_modules/**' --glob '!**/__pycache__/**' --glob '!**/.pytest_cache/**' --glob '!docs/archive/**' --glob '!docs/backend-mvp/P8-*.md' 'kokoro|KOKORO_|rvc|RVC_|use_rvc|rvc_available|rvc_applied|rvcApplied|X-RVC-Applied|kokoro_loaded|TTS_FALLBACK_ENGINE' audio-service backend ops tests
```

Expected: selected tests/builds pass and the scan returns no active runtime/config/test/Docker/bootstrap/backend/ESP contract reference. Package-lock hash text is not a semantic reference and is classified separately.

- [ ] **Step 4: Correct the candidate env boundary before candidate start**

Create a protected temporary env file from the existing Audio env using an allowlist. The generated file must preserve only the values required by the Piper-only Audio Service, including `INTERNAL_SERVICE_TOKEN`, and must reject every key whose name matches `KOKORO`, `RVC`, or `FALLBACK`.

Use this exact one-shot command; it writes values only to the protected file and prints only the resulting key names:

```bash
CANDIDATE_ENV=/opt/joy/config/piper-only-candidate.env
umask 077
python3 - "$CANDIDATE_ENV" <<'PY'
import os, re, sys
from pathlib import Path
src = Path('/opt/joy/config/audio.env')
dst = Path(sys.argv[1])
allow = {
    'AUDIO_SERVICE_HOST','AUDIO_SERVICE_PORT','INTERNAL_SERVICE_TOKEN',
    'MODEL_DOWNLOAD_ALLOWED','MODEL_MANIFEST_PATH','RUNTIME_MODELS_ROOT',
    'WHISPER_MODEL','WHISPER_MODEL_REPO','WHISPER_MODEL_REVISION',
    'WHISPER_DEVICE','WHISPER_COMPUTE_TYPE','WHISPER_CPU_THREADS',
    'WHISPER_WORKERS','WHISPER_BEAM_SIZE','WHISPER_VAD','WHISPER_HOTWORDS',
    'TTS_PRIMARY_ENGINE','PIPER_MODEL','PIPER_SPEAKER','PIPER_SPEAKER_ID',
    'PIPER_ENGINE_REVISION','PIPER_VOICE_REVISION','PIPER_MANIFEST_PATH',
    'HF_HOME','XDG_CACHE_HOME','HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE',
    'HF_HUB_DISABLE_TELEMETRY','ORT_DISABLE_ALL_NETWORK','TTS_TEMP_DIR',
}
values = {}
for raw in src.read_text().splitlines():
    raw = raw.strip()
    if not raw or raw.startswith('#') or '=' not in raw:
        continue
    key, value = raw.split('=', 1)
    if key in allow:
        values[key] = value
values.update({
    'AUDIO_SERVICE_HOST':'0.0.0.0', 'AUDIO_SERVICE_PORT':'8001',
    'MODEL_DOWNLOAD_ALLOWED':'false', 'HF_HUB_OFFLINE':'1',
    'TRANSFORMERS_OFFLINE':'1', 'HF_HUB_DISABLE_TELEMETRY':'1',
    'ORT_DISABLE_ALL_NETWORK':'1', 'TTS_PRIMARY_ENGINE':'piper',
    'PIPER_MODEL':'en_GB-semaine-medium', 'PIPER_SPEAKER':'prudence',
    'PIPER_SPEAKER_ID':'0', 'PIPER_MANIFEST_PATH':'/opt/joy/models/piper/PIPER_ASSET_MANIFEST.json',
    'RUNTIME_MODELS_ROOT':'/opt/joy/models/runtime',
    'MODEL_MANIFEST_PATH':'/opt/joy/models/runtime/MODEL_MANIFEST.json',
    'TTS_TEMP_DIR':'/opt/joy/temp/tts-candidate',
})
if 'INTERNAL_SERVICE_TOKEN' not in values:
    raise SystemExit('missing INTERNAL_SERVICE_TOKEN')
if any(re.search(r'(kokoro|rvc|fallback)', key, re.I) for key in values):
    raise SystemExit('forbidden legacy key generated')
dst.write_text(''.join(f'{k}={v}\\n' for k, v in sorted(values.items())))
dst.chmod(0o600)
print('candidate-env-keys=' + ','.join(sorted(values)))
PY
```

Expected: candidate env is mode `600`, contains no legacy key, and is used by setting `AUDIO_ENV_FILE=/opt/joy/config/piper-only-candidate.env`. If the candidate overlay still injects the production env file, fix the overlay to consume `AUDIO_ENV_FILE` before proceeding.

---

### Task 3: Pass the memory gate and render the isolated candidate

**Files:**
- Runtime only: candidate project `joy-piper-only-candidate`.
- Evidence: `$EVIDENCE_DIR`.

- [ ] **Step 1: Evaluate the hard pre-start gate**

Run:

```bash
available=$(awk '/^MemAvailable:/ {print $2*1024; exit}' /proc/meminfo)
printf 'MemAvailable=%s required=%s\\n' "$available" $((4*1024*1024*1024)) | tee "$EVIDENCE_DIR/memory-prestart-gate.txt"
if [ "$available" -lt $((4*1024*1024*1024)) ]; then
  printf '%s\\n' 'BLOCKED_RESOURCE: do not start candidate and do not purge' | tee -a "$EVIDENCE_DIR/memory-prestart-gate.txt"
  exit 75
fi
```

If blocked and no explicit maintenance authorization exists, stop this plan at Task 3. With the current user authorization, record the intentional maintenance window, stop only `joy-production-audio-1` after saving its digest/config, leave Backend/PostgreSQL/Hermes/monitoring running, and re-evaluate the gate. If candidate verification fails, restart the old Audio image immediately before reporting the failure.

- [ ] **Step 2: Render and inspect candidate topology**

Run with the sanitized env:

```bash
export P9_CANDIDATE_IMAGE=joy-p9.1-candidate@sha256:71011f1b2ee10852774bddd1bd03dd6ae0f7a66eea1e190e1c4981023792efe0
export AUDIO_CANDIDATE_IMAGE=joy-audio@sha256:24e1c4244ea8868f731d819ea75cb57c1e464b6df3bd9679d65fd4711643488c
export AUDIO_ENV_FILE=/opt/joy/config/piper-only-candidate.env
cd /opt/joy/app
docker compose --project-name joy-piper-only-candidate --env-file /opt/joy/config/p9.1/compose.env -f p9.1-compose.yml -f ops/deploy/piper-only-candidate-compose.yml config --format json > "$EVIDENCE_DIR/candidate-compose.json"
python3 - "$EVIDENCE_DIR/candidate-compose.json" <<'PY'
import json, re, sys
x=json.load(open(sys.argv[1])); s=x['services']; a=s['audio']; b=s['backend']
assert a['image'].endswith('24e1c4244ea8868f731d819ea75cb57c1e464b6df3bd9679d65fd4711643488c')
assert b['image'].endswith('71011f1b2ee10852774bddd1bd03dd6ae0f7a66eea1e190e1c4981023792efe0')
assert b['environment']['AUDIO_SERVICE_URL']=='http://127.0.0.1:8002'
assert any(str(p['published'])=='8002' and str(p['target'])=='8001' and p.get('host_ip')=='127.0.0.1' for p in a['ports'])
assert a['environment']['MODEL_DOWNLOAD_ALLOWED'].lower()=='false'
assert all(v.get('read_only') for v in a.get('volumes',[]) if v.get('target','').startswith(('/opt/joy/models','/opt/joy/cache/audio')))
serialized=json.dumps(x)
assert not re.search(r'kokoro|rvc|fallback', serialized, re.I)
print('candidate-topology=ok')
PY
```

Expected: candidate audio is private on port `8002`, backend points only to `8002`, model/cache mounts are read-only, downloads are disabled, and rendered topology contains no legacy token. A failure is a hard stop.

- [ ] **Step 3: Use the existing fail-closed helper as the only candidate launcher**

Do not manually start candidate containers before this command. The helper refuses pre-existing candidate state, starts Audio first, checks the 4 GiB and 1.5 GiB gates, runs readiness, starts candidate PostgreSQL and Backend only after Audio passes, executes real STT/Piper/FFmpeg and fake-ESP flow, asserts production identity is unchanged, and stops candidate services in its exit trap.

Run:

```bash
cd /opt/joy/app
P9_CANDIDATE_IMAGE=joy-p9.1-candidate@sha256:71011f1b2ee10852774bddd1bd03dd6ae0f7a66eea1e190e1c4981023792efe0 \
AUDIO_CANDIDATE_IMAGE=joy-audio@sha256:24e1c4244ea8868f731d819ea75cb57c1e464b6df3bd9679d65fd4711643488c \
AUDIO_ENV_FILE=/opt/joy/config/piper-only-candidate.env \
PIPER_CANDIDATE_WAV=/opt/joy/temp/p8-piper-production/public-speech.wav \
PIPER_CANDIDATE_EVIDENCE_DIR="$EVIDENCE_DIR/helper" \
PIPER_CANDIDATE_FULL_PIPELINE=1 \
bash ops/deploy/piper-only-low-memory-candidate.sh
```

Expected: helper exits `0`, writes readiness/resource/pipeline/fake-ESP evidence, and leaves no candidate service running. Any exit `75`, `76`, `77`, or `78` is a hard stop; preserve the evidence and do not promote or purge.

---

### Task 4: Review candidate evidence before promotion

**Files:**
- Read: `$EVIDENCE_DIR/helper/`.
- No production mutation.

- [ ] **Step 1: Confirm candidate evidence is complete**

Run:

```bash
find "$EVIDENCE_DIR/helper" -maxdepth 1 -type f -printf '%f\\n' | sort
for f in candidate-audio-pipeline.json candidate-backend-livez.json candidate-backend-readyz.json audio-readyz.json fake-esp.mp3; do test -e "$EVIDENCE_DIR/helper/$f" || { printf 'missing=%s\\n' "$f"; exit 1; }; done
```

Expected: helper evidence includes Audio liveness/readiness, candidate Backend health/readiness, real Audio pipeline report, fake-ESP MP3, and before/after protected production snapshots.

- [ ] **Step 2: Check the candidate contract and resource thresholds**

Run:

```bash
python3 - "$EVIDENCE_DIR/helper/audio-readyz.json" <<'PY'
import json, sys
x=json.load(open(sys.argv[1]))
assert x == {'status':'ok','stt_loaded':True,'piper_loaded':True,'ffmpeg_available':True}
print('ready-contract=ok')
PY
rg -n -i 'kokoro|rvc|fallback|8001' "$EVIDENCE_DIR/helper" && { printf '%s\\n' 'forbidden candidate evidence token'; exit 1; } || true
```

The `8001` scan is allowed only in the candidate Audio container's internal target port and Compose metadata; candidate Backend request routing must be `http://127.0.0.1:8002`. Confirm the helper's post-ready `MemAvailable` is at least `1610612736`, restart counts are zero, and all OOM flags are false.

- [ ] **Step 3: Freeze the promotion decision**

Promotion is allowed only when Tasks 1–4 are all green, candidate Audio and Backend image IDs match the recorded digests, production container identities are unchanged, and the complete candidate fake-ESP flow produced a valid non-empty MP3. Otherwise record `Joy_PIPER_ONLY_PURGE_RESULT=BLOCKED` and stop.

### Task 5: Promote only the Audio Service with deterministic rollback

**Files:**
- Modify only the protected runtime image reference used by `/opt/joy/app/docker-compose.yml`.
- Keep old Audio image and old env backup.

- [ ] **Step 1: Capture exact old and candidate digests immediately before promotion**

Run:

```bash
old_audio_image=$(docker inspect joy-production-audio-1 --format '{{.Config.Image}}')
old_backend_image=$(docker inspect joy-production-p9-backend-1 --format '{{.Config.Image}}')
candidate_audio_image=joy-audio@sha256:24e1c4244ea8868f731d819ea75cb57c1e464b6df3bd9679d65fd4711643488c
printf 'old_audio=%s\\nold_backend=%s\\ncandidate_audio=%s\\n' "$old_audio_image" "$old_backend_image" "$candidate_audio_image" | tee "$EVIDENCE_DIR/promotion-digests.txt"
test "$old_audio_image" = joy-audio@sha256:62ad9adead83d863ab2bf28a2ac75e5a116dc68bab8ff06eec81b7a0407ddb34
test "$(docker image inspect "$candidate_audio_image" --format '{{.Id}}')" = sha256:24e1c4244ea8868f731d819ea75cb57c1e464b6df3bd9679d65fd4711643488c
```

- [ ] **Step 2: Promote Audio only, preserving Backend and dependencies**

Stage and atomically activate the sanitized Piper-only production env after the old env has been copied to rollback evidence:

```bash
install -m 600 "$EVIDENCE_DIR/rollback/audio.env" /opt/joy/config/audio.env.rollback-copy
install -m 600 /opt/joy/config/piper-only-candidate.env /opt/joy/config/audio.env.piper-only
mv -f /opt/joy/config/audio.env.piper-only /opt/joy/config/audio.env
__omp_shell("rg -n -i 'kokoro|rvc|fallback' /opt/joy/config/audio.env")
sha256sum /opt/joy/config/audio.env | tee "$EVIDENCE_DIR/audio-env-piper-only.sha256"
```

Then recreate only the Audio Service:

```bash
cd /opt/joy/app
BACKEND_IMAGE="$old_backend_image" \
AUDIO_IMAGE="$candidate_audio_image" \
BACKEND_ENV_FILE=/opt/joy/config/p9.1/backend.env \
AUDIO_ENV_FILE=/opt/joy/config/audio.env \
docker compose --project-name joy-production -f /opt/joy/app/docker-compose.yml up -d --no-build --pull never --no-deps audio
```

The command must recreate only `joy-production-audio-1`. Confirm Backend, PostgreSQL, Hermes, Caddy, WhatsApp, and monitoring container identities are unchanged. Do not use `docker compose down`.

- [ ] **Step 3: Verify production Audio contract immediately**

Run:

```bash
curl --fail --silent --show-error http://127.0.0.1:8001/livez | tee "$EVIDENCE_DIR/production-livez.json"
curl --fail --silent --show-error http://127.0.0.1:8001/health | tee "$EVIDENCE_DIR/production-health.json"
curl --fail --silent --show-error http://127.0.0.1:8001/readyz | tee "$EVIDENCE_DIR/production-readyz.json"
docker inspect joy-production-audio-1 --format 'image={{.Config.Image}} id={{.Image}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}' | tee "$EVIDENCE_DIR/production-audio-after-promote.txt"
```

Expected: all endpoints pass, readiness has only `stt_loaded`, `piper_loaded`, `ffmpeg_available`, and the running image ID equals the candidate digest.

- [ ] **Step 4: Roll back immediately if promotion checks fail**

Run:

```bash
BACKEND_IMAGE="$old_backend_image" \
AUDIO_IMAGE="$old_audio_image" \
BACKEND_ENV_FILE=/opt/joy/config/p9.1/backend.env \
AUDIO_ENV_FILE="$EVIDENCE_DIR/rollback/audio.env" \
docker compose --project-name joy-production -f /opt/joy/app/docker-compose.yml up -d --no-build --pull never --no-deps audio
```

Then verify the old image ID, Audio health, Backend health, and public endpoint. Record the first failure and stop all purge work.

---

### Task 6: Verify production end-to-end and close rollback retention

**Files:**
- Evidence only: `$EVIDENCE_DIR`.
- Runtime: production Audio only.

- [ ] **Step 1: Run production Audio real inference**

Create a mode `600` token-only file without printing the token, run the real verifier, then remove the temporary token file:

```bash
PROD_TOKEN_FILE=$(mktemp /dev/shm/joy-audio-token.XXXXXX)
chmod 600 "$PROD_TOKEN_FILE"
awk -F= '$1 == "INTERNAL_SERVICE_TOKEN" { sub(/^[^=]*=/, ""); print; exit }' /opt/joy/config/audio.env > "$PROD_TOKEN_FILE"
test -s "$PROD_TOKEN_FILE"
cd /opt/joy/app
python3 audio-service/scripts/verify_voice_pipeline.py \
  --base-url http://127.0.0.1:8001 \
  --token-file "$PROD_TOKEN_FILE" \
  --wav /opt/joy/temp/p8-piper-production/public-speech.wav \
  --output "$EVIDENCE_DIR/production-audio.mp3" \
  --report "$EVIDENCE_DIR/production-audio-pipeline.json"
rm -f "$PROD_TOKEN_FILE"
```

Expected: real STT, Piper TTS, FFmpeg MP3, no fallback, and no RVC metadata.

- [ ] **Step 2: Run production Backend/Hermes/fake-ESP flow**

Run the existing fake-ESP command with the protected device token held only in a shell variable:

```bash
DEVICE_ID=$(awk -F= '$1 == "DEVICE_ID" { sub(/^[^=]*=/, ""); print; exit }' /opt/joy/config/p9.1/backend.env)
DEVICE_TOKEN=$(awk -F= '$1 == "DEVICE_TOKEN" { sub(/^[^=]*=/, ""); print; exit }' /opt/joy/config/p9.1/backend.env)
test -n "$DEVICE_ID" -a -n "$DEVICE_TOKEN"
cd /opt/joy/app
Joy_BASE_URL=http://127.0.0.1:3000 \
DEVICE_ID="$DEVICE_ID" \
DEVICE_TOKEN="$DEVICE_TOKEN" \
FAKE_ESP32_WAV_PATH=/opt/joy/temp/p8-piper-production/public-speech.wav \
FAKE_ESP32_OUTPUT_MP3_PATH="$EVIDENCE_DIR/production-fake-esp.mp3" \
FAKE_ESP32_TIMEOUT_MS=240000 \
npm --prefix backend run fake-esp32
unset DEVICE_TOKEN
```

Expected: upload, thinking, audio_ready, valid MP3, playback completion, and no change to the existing public WebSocket contract.

- [ ] **Step 3: Verify all protected services and public surface**

Run:

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/livez
curl --fail --silent --show-error http://127.0.0.1:3000/readyz
curl --fail --silent --show-error http://127.0.0.1:8001/livez
curl --fail --silent --show-error http://127.0.0.1:8001/health
curl --fail --silent --show-error http://127.0.0.1:8001/readyz
curl --fail --silent --show-error http://127.0.0.1:8642/health
curl --fail --silent --show-error http://127.0.0.1:8090/health
```

Expected: all required services pass; PostgreSQL remains healthy; public backend and WebSocket behavior remains unchanged.

- [ ] **Step 4: Capture post-promotion resource evidence**

Run:

```bash
{
  date --iso-8601=seconds
  free -h
  free -b
  docker stats --no-stream
  docker ps --format '{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}'
  df -h /opt/joy
  du -sb /opt/joy/models /opt/joy/cache/audio /opt/joy/temp /opt/joy/archive 2>/dev/null
} | tee "$EVIDENCE_DIR/resources-after-promotion.txt"
```

Do not claim a memory or disk improvement without numeric before/after evidence. Keep the old image and rollback env until this task passes.

---

### Task 7: Purge only reviewed legacy artifacts and update active documentation

**Files:**
- Modify active docs in the existing repository only after production verification:
  - `docs/backend-mvp/01-SCOPE-AND-DECISIONS.md`
  - `docs/backend-mvp/04-AUDIO-SERVICE.md`
  - `docs/backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md`
  - `docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md`
  - `docs/backend-mvp/IMPLEMENTATION-STATUS.md`
  - `docs/operations/2026-08-24-piper-only-purge-evidence.md`
  - `docs/superpowers/specs/2026-08-24-remove-rvc-design.md`
- Runtime deletion targets: only exact reviewed Kokoro paths; retained RVC archive is historical evidence, not active runtime.

- [ ] **Step 1: Re-inventory and classify every legacy path**

Run:

```bash
find /opt/joy/models /opt/joy/cache/audio /opt/joy/temp /opt/joy/archive -xdev \( -iname '*kokoro*' -o -iname '*rvc*' -o -iname '*rmvpe*' -o -iname '*hubert*' \) -print | sort | tee "$EVIDENCE_DIR/legacy-artifacts-before.txt"
du -sb /opt/joy/models/runtime/kokoro-82m-af-heart /opt/joy/models/kokoro /opt/joy/archive/p8-rvc 2>/dev/null | tee "$EVIDENCE_DIR/legacy-artifact-sizes.txt"
```

Expected current targets include the Kokoro runtime model, Kokoro model directory, and the exact Kokoro HuggingFace snapshot/lock paths. Keep `/opt/joy/archive/p8-rvc` as historical evidence unless a separate retention decision explicitly authorizes archiving it elsewhere. Shared `hf-cache` roots, Whisper, Piper, PostgreSQL, and current production rollback image are not deletion targets.

- [ ] **Step 2: Delete only explicit obsolete paths after verification**

Use explicit reviewed paths, not a wildcard over model/cache roots. Keep `/opt/joy/archive/p8-rvc` untouched as historical evidence. The deletion command must be executed only after Tasks 5 and 6 pass and the old image is retained:

```bash
rm -rf -- /opt/joy/models/runtime/kokoro-82m-af-heart /opt/joy/models/kokoro /opt/joy/models/hf-cache/hub/models--hexgrad--Kokoro-82M /opt/joy/models/hf-cache/hub/.locks/models--hexgrad--Kokoro-82M
```

Before running it, confirm the exact path list from `legacy-artifacts-before.txt`; if any path differs or contains shared content, stop and revise the target list. Do not delete the whole `/opt/joy/models/runtime`, `/opt/joy/models/hf-cache`, `/opt/joy/cache/audio`, `/opt/joy/temp`, or `/opt/joy/archive` directory.

- [ ] **Step 3: Verify legacy config keys are absent after the new image is active**

The production env was already switched through the protected staged-file procedure in Task 5. Do not edit it again here; validate the active file:

```bash
__omp_shell("rg -n -i 'kokoro|rvc|fallback' /opt/joy/config/audio.env")
rg -n '^(PIPER|WHISPER|MODEL|AUDIO_SERVICE|INTERNAL_SERVICE_TOKEN|HF_|TRANSFORMERS_|ORT_|TTS_TEMP_DIR)' /opt/joy/config/audio.env | cut -d= -f1 | sort
```

If validation fails, restore the saved env immediately and keep the new image running only if its startup contract is independently healthy; otherwise rollback to the old image.

- [ ] **Step 4: Update active docs and label retained history**

Active docs must describe only:

```text
faster-whisper → Hermes → Piper → FFmpeg → MP3
```

Mark older P8 fallback/RVC evidence with `DEPRECATED`, `HISTORICAL ONLY`, and `DO NOT IMPLEMENT`. Do not rewrite Git history or remove immutable historical commits. Add the exact candidate/production digests, resource measurements, artifact list, verification outputs, rollback command, and known limitation (`MemAvailable` gate) to the evidence report.

---

### Task 8: Final semantic, operational, and repository verification

**Files:**
- Modify only intended active docs/evidence and runtime config.
- Do not modify unrelated dirty files.

- [ ] **Step 1: Verify no active legacy semantics remain**

Run:

```bash
cd /opt/joy/app
rg -n -i --hidden --glob '!.git/**' --glob '!node_modules/**' --glob '!**/__pycache__/**' --glob '!**/.pytest_cache/**' --glob '!docs/archive/**' --glob '!docs/backend-mvp/P8-*.md' 'kokoro|KOKORO_|rvc|RVC_|use_rvc|rvc_available|rvc_applied|rvcApplied|X-RVC-Applied|kokoro_loaded|TTS_FALLBACK_ENGINE' audio-service backend ops tests /opt/joy/config/audio.env
```

Expected: no active runtime/config/test/Docker/bootstrap/backend/ESP contract references. Remaining matches are only in explicitly historical/deprecated docs or immutable Git history and are listed in the evidence report.

- [ ] **Step 2: Re-check production identities and health**

Run:

```bash
docker inspect joy-production-audio-1 joy-production-p9-backend-1 joy-production-p9-postgres-1 --format '{{.Name}} image={{.Image}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}'
curl --fail --silent --show-error http://127.0.0.1:8001/readyz
curl --fail --silent --show-error http://127.0.0.1:3000/readyz
```

Expected: Piper-only Audio is healthy, protected services are healthy, restart counts are unchanged except the intentional Audio replacement, and all OOM flags are false.

- [ ] **Step 3: Run repository verification and preserve unrelated changes**

From the clean task worktree, run:

```bash
python3 -m pytest audio-service/tests piper-candidate/tests tests/packaging tests/operations tests/verification -q
cd backend && npm test && npm run typecheck && npm run build
cd /opt/joy/app
git diff --check
git status --short
```

Expected: tests/build pass; status contains only the pre-existing unrelated dirty paths plus intentional Piper-only documentation/evidence changes. No unrelated file is staged or reset.

- [ ] **Step 4: Write the final result record**

Create `docs/operations/2026-08-24-piper-only-purge-evidence.md` with one of:

```text
Joy_PIPER_ONLY_PURGE_RESULT=PASS
```

Only use `PASS` when candidate and post-promotion real end-to-end checks passed, the old image remains available, the active semantic scan is clean, and numeric resource before/after evidence exists. Otherwise use:

```text
Joy_PIPER_ONLY_PURGE_RESULT=BLOCKED
```

Include the first failed gate, production safety state, retained rollback image, and exact next safe action. Never report `PASS` for a candidate-only test or a source-only build.

---

## Execution order and stop points

1. Tasks 1–2 are read-only/source verification plus protected temporary env generation.
2. Task 3 stops at the 4 GiB memory gate. Current observed state is below the gate, so execution is expected to stop there unless host memory changes or a separately authorized maintenance window frees memory safely.
3. Tasks 4–6 may run only after Task 3 passes; promotion is isolated to Audio.
4. Task 7 deletes legacy artifacts only after real production verification and rollback retention.
5. Task 8 is the completion gate. A blocked result is safe and valid; it is not a reason to bypass memory or rollback controls.

# P2 — Audio Service bootstrap + faster-whisper STT Implementation Plan

> **HISTORICAL PHASE RECORD — NOT A CURRENT EXECUTION INSTRUCTION.** This file records the P1–P5 state/ownership at the time it was written. References to “P6” or old runtime defaults inside this record are historical. For current execution order and ownership, use `../NEXT-ACTION.md`, `IMPLEMENTATION-STATUS.md`, and `../roadmap/P6-P10-ROADMAP.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build only P2: a localhost FastAPI Audio Service with authenticated internal STT, faster-whisper integration boundary, model bootstrap/cache support, WAV handling, no-speech handling, and P2 tests.

**Architecture:** `audio-service/` is a separate Python service. FastAPI owns HTTP/auth/schema; `Transcriber` protocol isolates real faster-whisper from deterministic tests; WAV validation uses Python standard-library parsing before inference. P3 Kokoro/RVC/FFmpeg, P4 Hermes, P6 deployment, firmware, and physical hardware remain out of scope.

**Tech Stack:** Python 3.10+ target, FastAPI, Uvicorn, Pydantic settings, pytest, faster-whisper optional runtime dependency.

---

## File structure

- Create `audio-service/app/config.py`: environment validation and derived config.
- Create `audio-service/app/auth.py`: `X-Internal-Service-Token` dependency.
- Create `audio-service/app/wav.py`: WAV byte validation and temporary file context.
- Create `audio-service/app/schemas.py`: health and STT response models.
- Create `audio-service/app/stt.py`: transcriber protocol, no-speech normalization, real faster-whisper adapter, mock adapter.
- Create `audio-service/app/main.py`: FastAPI app factory, `/health`, `/stt/transcribe`.
- Create `audio-service/scripts/bootstrap_whisper.py`: cache/bootstrap smoke helper, with `--dry-run`.
- Create `audio-service/tests/`: config, auth, health, WAV, STT, integration tests.
- Create `audio-service/requirements.txt`, `requirements-dev.txt`, `.gitignore`.
- Modify `docs/backend-mvp/IMPLEMENTATION-STATUS.md`: P2 `IN_PROGRESS` before source coding, then `IMPLEMENTED` if test evidence is complete.
- Modify `docs/backend-mvp/P2-TEST-EVIDENCE.md`: command evidence, mock vs real inference status.
- Modify `docs/backend-mvp/CHANGELOG.md`: P2 implementation entry.

## Task 1: P2 control state before coding

- [ ] Update `IMPLEMENTATION-STATUS.md` P2 evidence to `IN_PROGRESS`.
- [ ] Record that real faster-whisper inference is required before P2 can be `VERIFIED — BACKEND`.
- [ ] Run `python scripts/verify-backend-mvp-docs.py`; expected PASS.

## Task 2: RED tests for config/auth/health

- [ ] Write tests expecting env validation to require `INTERNAL_SERVICE_TOKEN`, pin default faster-whisper settings, and reject short token.
- [ ] Write tests expecting missing/wrong `X-Internal-Service-Token` to return 401/403 without exposing secrets.
- [ ] Write tests expecting `/health` to report `ok` when fake STT is ready and `loading`/`error` when not.
- [ ] Run focused pytest; expected FAIL because audio service files do not exist.

## Task 3: GREEN config/auth/health

- [ ] Implement `Settings`, token auth dependency, `HealthState`, and app factory.
- [ ] Keep health scoped to STT only for P2. Kokoro/RVC/FFmpeg health is not implemented.
- [ ] Run focused pytest; expected PASS.

## Task 4: RED tests for WAV handling and STT response shape

- [ ] Write tests for raw `audio/wav`, invalid content type, missing token, corrupt WAV, valid 16 kHz mono PCM WAV, no-speech output, Indonesian, English, and mixed-language transcripts.
- [ ] Use fake transcriber fixtures; do not require local model download.
- [ ] Run focused pytest; expected FAIL for missing implementation.

## Task 5: GREEN WAV handling and fake STT path

- [ ] Implement WAV validator with RIFF/WAVE, PCM signed 16-bit LE, mono, 16 kHz, duration.
- [ ] Implement `/stt/transcribe` to read raw body, validate content type/auth/WAV, write temp file, call injected transcriber, delete temp file, and return canonical JSON.
- [ ] Normalize no-speech when segments are empty, transcript is empty, or `duration_after_vad` is zero.
- [ ] Run focused pytest; expected PASS.

## Task 6: RED/GREEN real faster-whisper adapter boundary

- [ ] Write adapter tests using a stub `WhisperModel` class to assert model args: model `small`, device `cpu`, compute type `int8`, cpu threads `4`, workers `1`.
- [ ] Assert `transcribe` receives `language=None`, `task="transcribe"`, `beam_size=5`, `vad_filter=True`.
- [ ] Implement `FasterWhisperTranscriber` with lazy import and clear error if dependency/model unavailable.
- [ ] Run adapter tests; expected PASS with stub, not real model.

## Task 7: Bootstrap/cache support

- [ ] Write dry-run test for `scripts/bootstrap_whisper.py` proving it resolves cache paths and writes no model files.
- [ ] Implement bootstrap helper that sets `HF_HOME`, `TORCH_HOME`, attempts real model load only without `--dry-run`, and writes manifest metadata if inference succeeds.
- [ ] Do not download or commit model files.

## Task 8: Full P1/P2 verification

- [ ] Run `python scripts/verify-backend-mvp-docs.py`.
- [ ] Run `cd backend && npm test`.
- [ ] Run `cd backend && npm run typecheck`.
- [ ] Run `cd backend && npm run build`.
- [ ] Run `cd backend && npm audit`.
- [ ] Run `cd audio-service && <workspace-python> -m pytest`.
- [ ] Run `cd audio-service && <workspace-python> -m compileall app scripts`.
- [ ] Run `cd audio-service && <workspace-python> scripts/bootstrap_whisper.py --dry-run`.
- [ ] Record mock vs real inference evidence. P2 must not be marked `VERIFIED` if real faster-whisper inference did not run.

## Out of scope guard

- No Kokoro.
- No RVC.
- No full FFmpeg TTS/MP3 pipeline.
- No Hermes integration.
- No VPS deployment.
- No firmware or physical hardware.
- No P3–P6 authorization.

# P3 — Kokoro + FFmpeg + RVC fallback Implementation Plan

> **HISTORICAL PHASE RECORD — NOT A CURRENT EXECUTION INSTRUCTION.** This file records the P1–P5 state/ownership at the time it was written. References to “P6” or old runtime defaults inside this record are historical. For current execution order and ownership, use `../NEXT-ACTION.md`, `IMPLEMENTATION-STATUS.md`, and `../roadmap/P6-P10-ROADMAP.md`.

> **For agentic workers:** Execute inline in this session. No subagent delegation unless the user explicitly asks for it.

**Goal:** Implement only P3 Audio Service voice synthesis: Kokoro English TTS, optional RVC BMO conversion, FFmpeg MP3 output, authenticated internal `/tts/synthesize`, model/cache safety, cleanup, tests, and local evidence.

**Architecture:** Keep P3 inside `audio-service/`. FastAPI remains the HTTP/auth boundary; `tts.py` owns text validation and synthesis orchestration; `kokoro_tts.py`, `ffmpeg.py`, and `rvc.py` isolate external runtimes behind injectable adapters; scripts handle safe model bootstrap and real local verification. Express backend, Hermes, public WebSocket/API, firmware, deployment, and P4–P6 remain untouched.

**Tech Stack:** Python FastAPI, Pydantic settings, Kokoro `KPipeline`, SoundFile, FFmpeg/ffprobe CLI, Hugging Face Hub exact-revision file download, optional RVC inference adapter, pytest.

---

## Acceptance map

| ID | Requirement | Evidence |
|---|---|---|
| P3-AC-01 | P3 phase authorized and active; P4–P6 locked | `IMPLEMENTATION-STATUS.md`, docs verifier |
| P3-AC-02 | Kokoro American English `af_heart`, 24 kHz WAV | unit tests, real Kokoro verification |
| P3-AC-03 | text validation: trim, non-empty, ~600 chars, max 3 short sentences, English plain text | unit/API tests |
| P3-AC-04 | merge every Kokoro waveform segment into one complete WAV | unit test with multi-segment fake, real output |
| P3-AC-05 | FFmpeg produces mono 24 kHz 96 kbps MP3 | ffprobe tests and real verification |
| P3-AC-06 | RVC model downloaded from exact revision, size/hash verified before extract, archive inspected, no scripts executed | bootstrap script tests, manifest |
| P3-AC-07 | RVC applied if real adapter available; fallback Kokoro-only if RVC unavailable/fails | unit/API tests, forced-failure verification |
| P3-AC-08 | `/tts/synthesize` returns `audio/mpeg`, `X-RVC-Applied`, `X-TTS-Engine` | API tests |
| P3-AC-09 | `/health` reports `ok`, `degraded`, or `error` from STT/Kokoro/FFmpeg/RVC readiness | health tests |
| P3-AC-10 | all intermediate WAV/RVC files deleted on success and failure | cleanup tests and real verification |
| P3-AC-11 | no P4 orchestration, Hermes integration, deployment, firmware, public interface changes | scope audit |

## File plan

- Modify `audio-service/app/config.py`: add Kokoro, FFmpeg, output MP3, temp, and RVC settings.
- Modify `audio-service/app/schemas.py`: add TTS request schema and constrained health state.
- Modify `audio-service/app/main.py`: add injectable TTS synthesizer, `/tts/synthesize`, and P3 health composition.
- Create `audio-service/app/tts.py`: text validation, `TtsResult`, `TtsEngineState`, orchestration, cleanup.
- Create `audio-service/app/kokoro_tts.py`: real Kokoro adapter and waveform merge to WAV.
- Create `audio-service/app/ffmpeg.py`: FFmpeg conversion and ffprobe metadata helper.
- Create `audio-service/app/rvc.py`: safe RVC asset metadata, optional adapter, unavailable/failure fallback contract.
- Create `audio-service/scripts/bootstrap_rvc.py`: exact Hugging Face download, size/hash verification, archive inspection/extraction, manifest JSON.
- Create `audio-service/scripts/verify_voice_pipeline.py`: real Kokoro/FFmpeg/RVC/fallback verification and ffprobe evidence.
- Add tests: `tests/test_tts.py`, `tests/test_tts_api.py`, `tests/test_kokoro_tts.py`, `tests/test_ffmpeg.py`, `tests/test_rvc_bootstrap.py`.
- Modify `audio-service/requirements.txt` and `requirements-verify.txt`: pin runtime/verification dependencies actually used.
- Modify docs/evidence: `P3-TEST-EVIDENCE.md`, `IMPLEMENTATION-STATUS.md`, `CHANGELOG.md`, `audio-service/MODEL_MANIFEST.md`.

## Execution steps

1. Run current docs verifier after phase-control update.
2. Write RED tests for P3 config, text validation, TTS orchestration, headers, health, cleanup, FFmpeg command, RVC bootstrap safety, and fallback.
3. Run focused pytest and confirm failures are caused by missing P3 implementation.
4. Implement minimal P3 config/schema/orchestration/adapters.
5. Run focused pytest until green.
6. Add safe RVC bootstrap script and verification script.
7. Run real Kokoro + FFmpeg verification for three canonical sentences.
8. Attempt exact RVC model bootstrap and real RVC inference only inside `audio-service/models/` and `audio-service/temp/`; if unavailable, record blocker and keep P3 `IMPLEMENTED — not VERIFIED`.
9. Run full P1–P3 regression commands.
10. Audit scope, generated files, secrets, skipped tests, `.only`, canonical docs, public interface, and P4–P6 authorization.
11. Update evidence/status/changelog from actual output only.
12. Commit with `feat: implement P3 Kokoro FFmpeg and RVC fallback` if audit passes. Add separate verification commit only if real RVC verification succeeds after implementation commit.

## Verification commands

```powershell
python scripts/verify-backend-mvp-docs.py
cd backend
npm test
npm run typecheck
npm run build
npm audit
npm run fake-esp32
cd ../audio-service
python -m pytest
python -m compileall app tests scripts
python -m pip check
python scripts/verify_voice_pipeline.py --models-dir .\models --temp-dir .\temp\p3-real-voice --results .\temp\p3-real-voice-results.json
```

Every MP3 produced by real verification must also be checked with `ffprobe` for codec, duration, sample rate, channel count, and bitrate.

## Out-of-scope guard

- No Express backend integration.
- No Hermes adapter/orchestration.
- No public backend endpoint, WebSocket event, hardware contract, or PRD change.
- No deployment VPS, firewall/domain/TLS, firmware, physical ESP32, database, Spotify, WhatsApp, or mobile app.
- P4–P6 remain `NOT AUTHORIZED`.

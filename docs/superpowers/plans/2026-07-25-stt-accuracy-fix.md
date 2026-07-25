# STT Accuracy Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve real faster-whisper transcription of short local English commands while preserving automatic English, Indonesian, mixed-language, silence, and noise behavior.

**Architecture:** Keep the `/stt/transcribe` API unchanged. Upgrade the default multilingual faster-whisper model from `small` to `medium`, pass the product hotword `BMO` through the library-supported `hotwords` argument, and keep language auto-detection, VAD, and beam search behavior unchanged. Keep the personal voice fixture under ignored `manual-validation/` and record reproducible real-inference evidence separately from unit tests.

**Tech Stack:** Python 3.12, FastAPI, faster-whisper 1.2.1, CTranslate2 CPU/int8, pytest, FFmpeg/ffprobe.

---

### Task 1: Lock the intended configuration with failing tests

**Files:**
- Modify: `audio-service/tests/test_config.py`
- Modify: `audio-service/tests/test_stt.py`
- Modify: `audio-service/tests/test_bootstrap_whisper.py`

- [ ] **Step 1: Change configuration expectations**

Expect `Settings.whisper_model == "medium"` and `Settings.whisper_hotwords == "BMO"`.

- [ ] **Step 2: Change adapter expectations**

Require the real adapter call shape to include:

```python
assert captured["transcribe_kwargs"] == {
    "language": None,
    "task": "transcribe",
    "beam_size": 5,
    "vad_filter": True,
    "hotwords": "BMO",
}
```

- [ ] **Step 3: Change bootstrap manifest expectation**

Require the dry-run manifest to report `medium` and `BMO`.

- [ ] **Step 4: Run RED verification**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_config.py tests\test_stt.py tests\test_bootstrap_whisper.py -q
```

Expected: failures because production defaults and adapter arguments still use `small` without hotwords.

### Task 2: Implement the minimal STT configuration change

**Files:**
- Modify: `audio-service/app/config.py`
- Modify: `audio-service/app/stt.py`
- Modify: `audio-service/scripts/bootstrap_whisper.py`
- Modify: `audio-service/scripts/verify_real_inference.py`
- Create: `audio-service/tests/test_verify_real_inference.py`

- [ ] **Step 1: Add the default model and hotword settings**

```python
whisper_model: str = "medium"
whisper_hotwords: str | None = "BMO"
```

- [ ] **Step 2: Pass hotwords to faster-whisper**

```python
raw_segments, info = model.transcribe(
    str(audio_path),
    language=None,
    task="transcribe",
    beam_size=self._settings.whisper_beam_size,
    vad_filter=self._settings.whisper_vad,
    hotwords=self._settings.whisper_hotwords,
)
```

- [ ] **Step 3: Record hotwords in bootstrap manifests**

Add `whisper_hotwords` to `build_manifest`.

- [ ] **Step 4: Make real-inference metadata follow the configured model**

Pass `settings.whisper_model` to `model_cache_metadata` instead of reporting the old hardcoded `small` cache. Cover this with a focused unit test.

- [ ] **Step 5: Run GREEN verification**

Run the same focused pytest command. Expected: all focused tests pass.

### Task 3: Document model and investigation evidence

**Files:**
- Modify: `audio-service/MODEL_MANIFEST.md`
- Create: `docs/backend-mvp/P5-STT-ACCURACY-INVESTIGATION.md`

- [ ] **Step 1: Update model metadata**

Record:

```text
Model: medium multilingual
Revision: 08e178d48790749d25932bbc082711ddcfdfbc4f
Cached bytes: 1530572644
Device/compute: cpu/int8
Language: auto-detect
Hotwords: BMO
```

- [ ] **Step 2: Record baseline and audio analysis**

Include codec, sample rate, channels, bit depth, duration, RMS/peak levels, clipping result, leading/trailing silence, baseline transcript, language probability, segment confidence/no-speech metrics, and cold inference duration.

- [ ] **Step 3: Record configuration comparison and decision**

Document that resampling, +4 dB gain, disabling VAD, forced English, beam 10, disabling previous-text conditioning, timestamps, and `small/float32` did not solve the utterance; `medium` recovered the sentence structure and `BMO` hotword improved the product name and decoding confidence.

- [ ] **Step 4: Document private-fixture regression command**

Keep `manual-validation/audio/suara cenna.wav` ignored and document canonical conversion plus actual Audio Service request. Do not commit the personal voice recording.

### Task 4: Verify real inference and regressions

**Files:**
- No production file changes.
- Ignored evidence: `audio-service/temp/`, `manual-validation/temp/`, `manual-validation/reports/`.

- [ ] **Step 1: Start Audio Service with production defaults**

Bind only `127.0.0.1:8001` with local test token and local model cache.

- [ ] **Step 2: Transcribe the private fixture through HTTP**

Expected normalized result: close to `Hello BMO, what is two plus two?`, with `BMO`/`Bmo`/`Bemo` accepted and no hardcoded replacement.

- [ ] **Step 3: Run real sample matrix**

```powershell
.\.venv\Scripts\python.exe scripts\verify_real_inference.py --models-dir .\models --fixtures-dir .\temp\real-inference-fixtures --results .\temp\stt-medium-regression.json --skip-generate
```

Expected: English, Indonesian, mixed language contain speech; silence and noise remain no-speech; `all_pass` is true.

- [ ] **Step 4: Run the full Audio Service suite**

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Expected: zero failures.

### Task 5: Review and commit only relevant files

**Files:**
- All files listed in Tasks 1-3.

- [ ] **Step 1: Review diff and status**

Confirm no backend contract, public endpoint, private audio fixture, model cache, or unrelated P5 manual-validation files are staged.

- [ ] **Step 2: Commit**

```powershell
git add audio-service/app/config.py audio-service/app/stt.py audio-service/scripts/bootstrap_whisper.py audio-service/scripts/verify_real_inference.py audio-service/tests/test_config.py audio-service/tests/test_stt.py audio-service/tests/test_bootstrap_whisper.py audio-service/tests/test_verify_real_inference.py audio-service/MODEL_MANIFEST.md docs/backend-mvp/P5-STT-ACCURACY-INVESTIGATION.md docs/superpowers/plans/2026-07-25-stt-accuracy-fix.md
git commit -m "fix: improve multilingual STT accuracy"
```

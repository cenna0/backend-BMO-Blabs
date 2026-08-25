# Indonesian Reaction Audio Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate ten short reaction MP3s with the configured Piper voice and package them for download.

**Architecture:** Probe the existing audio service first and use it when available; otherwise synthesize with the pinned local Piper model. Pass every source through one FFmpeg normalization step that trims excessive edge silence and emits mono 22,050 Hz, 32 kbps CBR MP3. Verify each output independently, then create a ZIP containing exactly the ten MP3s.

**Tech Stack:** Existing Piper TTS pipeline, Python/HTTP or local Piper runtime, FFmpeg/ffprobe, zip.

---

### Task 1: Resolve the configured runtime

**Files:**
- Read: `audio-service/app/config.py`
- Read: `audio-service/PIPER_ASSET_MANIFEST.json`
- Output: runtime probe results only

- [x] Check whether the configured TTS service is healthy and whether the pinned Piper model files exist. Use the existing voice values: `en_GB-semaine-medium`, `prudence`, speaker ID `0`.
- [x] Select the service path when healthy; otherwise select the local Piper path. Do not substitute another voice.

### Task 2: Synthesize the ten source clips

**Files:**
- Create: `audio_mp3/.source/01.wav` through `10.wav` (temporary intermediates)

- [x] Synthesize exactly these texts, one per source file: `Yeeaayyyy!`, `Heheheee!`, `Woaaahh!`, `Zzzzzzzz`, `Hei!`, `Huhuuu`, `Psst!`, `Hah?!`, `Aww!`, and `Lho?`.
- [x] Keep filenames and text mapping explicit so no number or comment can enter the spoken audio.

### Task 3: Normalize and trim output

**Files:**
- Create: `audio_mp3/01.mp3` through `10.mp3`

- [x] Run FFmpeg with mono output, 22,050 Hz, `libmp3lame`, `-b:a 32k`, and CBR settings; trim only leading/trailing silence with a conservative threshold and short retained padding.
- [x] Keep the final files short and ensure each output is written beneath `audio_mp3/`.

### Task 4: Verify and package

**Files:**
- Create: `audio_mp3.zip`

- [x] Use `ffprobe` to verify every file is MP3, mono, 22,050 Hz, and 32 kbps CBR; decode each file with FFmpeg to confirm it is playable.
- [x] Print each filename and byte size.
- [x] Create `audio_mp3.zip` with exactly `01.mp3` through `10.mp3` at the archive root and verify the archive listing.

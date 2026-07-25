# P5 STT Accuracy Investigation

**Date:** 2026-07-25

**Scope:** local Audio Service only

**Fixture:** `D:\codex\BMO\manual-validation\audio\suara cenna.wav`

**Fixture policy:** personal voice recording; retained under ignored `manual-validation/`, not committed

## Result

The real Audio Service baseline produced:

```text
I'll be more where is to the steel
```

The selected configuration produces consistently:

```text
Hello BMO, where is 2 plus 2?
```

After case, punctuation, and numeral normalization, this has one word substitution versus:

```text
Hello BMO, what is two plus two?
```

Token accuracy is approximately `85.7%` (one substitution across seven words). No transcript, filename, phrase, or error-string replacement is present.

## Active baseline configuration

| Field | Baseline |
|---|---|
| faster-whisper | `1.2.1` |
| Model | `small` multilingual |
| Device / compute | `cpu` / `int8` |
| CPU threads / workers | `4` / `1` |
| Language | `None` / auto-detect |
| Task | `transcribe` |
| Beam size | `5` |
| VAD | enabled, faster-whisper defaults |
| Condition on previous text | library default `true` |
| Initial prompt | none |
| Hotwords | none |

Baseline actual HTTP result:

| Metric | Value |
|---|---|
| Transcript | `I'll be more where is to the steel` |
| Detected language | `en` |
| Language probability | `0.2006448656` |
| Audio duration | `4.8935 s` |
| Duration after VAD | `4.1735 s` |
| Segment | `0.72–3.84 s` |
| Average log probability | `-0.826262` |
| No-speech probability | `0.377955` |
| Compression ratio | `0.85` |
| Temperature | `0.0` |
| Cold HTTP inference | `16.949 s` |

The low language probability and weak segment confidence show model uncertainty. The wrong transcript was reproducible through the actual `/stt/transcribe` endpoint.

## Audio validation

Source SHA-256:

```text
55206D7D6E6033BA2757FEBBFC6270A8EDCED3024170EE8600111B7FBE811B19
```

| Field | Source file |
|---|---|
| Container / codec | WAV / `pcm_s16le` |
| Sample rate | `48000 Hz` |
| Channels | mono |
| Bit depth | `16-bit` (`14/16` effective per `astats`) |
| Duration | `4.8935 s` |
| Mean / RMS level | `-25.2 dB` |
| Peak level | `-7.223 dB` |
| Sample extrema | `-14265` / `13008` |
| Clipping | none; extrema remain below signed 16-bit limits |
| DC offset | `-0.000101` |
| Leading silence (`-40 dB`) | `0–0.641458 s` |
| Trailing silence (`-40 dB`) | `3.958917–4.8935 s` (`0.934583 s`) |

The source is valid and not clipped or corrupt. The project endpoint correctly requires canonical PCM 16-bit, 16 kHz, mono, so the runner resamples the 48 kHz source before upload. Direct faster-whisper decoding of the original 48 kHz file and the canonical 16 kHz file produced identical baseline output, ruling out FFmpeg resampling as the cause.

Signal analysis identifies a stable speech region between the leading and trailing silence. The stronger multilingual model recovers the expected product name, sentence structure, and `two plus two`, confirming the file contains usable speech rather than damaged audio.

## Controlled comparison

All comparisons used the same source and local faster-whisper runtime.

| Configuration | Transcript | Language probability | Inference |
|---|---|---:|---:|
| `small/int8`, canonical baseline | `I'll be more where is to the steel` | `0.200645` | `8.785 s` warm diagnostic |
| `small/int8`, original 48 kHz | same as baseline | `0.200645` | `5.701 s` |
| `small/int8`, gain `+4 dB` | same as baseline | `0.172301` | comparable |
| `small/int8`, VAD disabled | `I'll be more where is to this tool` | `0.334874` | `6.388 s` |
| `small/int8`, previous-text disabled | same as baseline | `0.200645` | `5.945 s` |
| `small/int8`, beam `10` | same as baseline | `0.200645` | `6.828 s` |
| `small/int8`, forced English diagnostic | same as baseline | forced `1.0` | `4.363 s` |
| `small/int8`, hotword `BMO` | `Hello BMO, where is 2? Where is 2?` | `0.200645` | `6.223 s` |
| `small/float32`, hotword `BMO` | `Hello BMO, where is 2? Where is 2?` | `0.223068` | `10.554 s` |
| `medium/int8`, no hotword | `Hello Bmo, where is 2 plus 2?` | `0.263552` | `15.405 s` |
| `medium/int8`, hotword `BMO` | `Hello BMO, where is 2 plus 2?` | `0.263552` | `15.082 s` |
| `large-v3-turbo/int8`, hotword `BMO` | `Hello BMO, where is still the still?` | `0.671080` | `25.151 s` |

Additional `small` experiments using `initial_prompt`, `multilingual=True`, `word_timestamps`, and `without_timestamps` did not recover the intended question. Generic English and bilingual `medium` prompts describing questions, calculations, reminders, and commands also left the result unchanged. The `large-v3-turbo` candidate was slower and less accurate on this local CPU/sample despite higher language confidence.

## Root cause and selected fix

Root cause: the multilingual `small` acoustic/decoder capacity is insufficient for this short accented utterance. Evidence against other hypotheses:

- Resampling produced byte-valid canonical WAV and identical decoding behavior.
- Peak and RMS levels are usable; `+4 dB` did not help.
- Default VAD preserves `4.1735 s`; disabling it did not recover words.
- Forced English, beam `10`, previous-text changes, and float32 did not help.
- The model is uncertain: baseline language probability `0.2006`, average log probability `-0.8263`.

Selected minimal general fix:

```text
WHISPER_MODEL=medium
WHISPER_HOTWORDS=BMO
```

Auto-detection (`language=None`), multilingual model support, VAD, beam size `5`, and previous-text behavior remain unchanged. `hotwords` is a supported faster-whisper `WhisperModel.transcribe` argument and is product context, not a transcript replacement.

The hotword improved the `medium` result from `Bmo` to `BMO`, average log probability from `-0.803086` to `-0.628701`, and no-speech probability from `0.206860` to `0.081402`.

## Post-change real result

Actual `/stt/transcribe` response:

```json
{
  "text": "Hello BMO, where is 2 plus 2?",
  "speech_detected": true,
  "language": "en",
  "language_probability": 0.2635522186756134,
  "duration_seconds": 4.8935
}
```

| Timing | Before (`small`) | After (`medium` + `BMO`) |
|---|---:|---:|
| Cold HTTP inference | `16.949 s` | `31.010 s` |
| Warm inference | approximately `5.7–8.8 s` | `16.610 s` |

The accuracy improvement costs CPU latency and about `1.53 GB` peak RSS during the real regression matrix. This is acceptable for local manual validation but should be re-evaluated against deployment latency requirements before VPS deployment.

## Multilingual and no-speech regression

Real fixture matrix after the selected change:

| Fixture | Transcript | Language | Speech | Result |
|---|---|---|---:|---|
| English | `Hello BMO, please help me remember the meeting tomorrow.` | `en` | true | PASS |
| Indonesian | `Halo BMO, tolong bantu aku mengingat jadwal hari ini` | `id` | true | PASS |
| Mixed | `BMO, tolong remin aku about the meeting tomorrow.` | `id` | true | PASS |
| Silence | empty | `null` | false | PASS |
| Noise | empty | `null` | false | PASS |

## Re-run private fixture

The private fixture remains ignored. Convert and test through the real Audio Service:

```powershell
ffmpeg -hide_banner -loglevel error -y `
  -i "D:\codex\BMO\manual-validation\audio\suara cenna.wav" `
  -acodec pcm_s16le -ar 16000 -ac 1 `
  "D:\codex\BMO\manual-validation\temp\stt-investigation-suara-cenna-16k.wav"

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8001/stt/transcribe" `
  -Headers @{"x-internal-service-token"="local-internal-token"} `
  -ContentType "audio/wav" `
  -InFile "D:\codex\BMO\manual-validation\temp\stt-investigation-suara-cenna-16k.wav"
```

The API request/response contract is unchanged.

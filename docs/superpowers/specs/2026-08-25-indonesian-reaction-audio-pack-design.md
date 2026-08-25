# Indonesian Reaction Audio Pack Design

## Goal

Create ten short reaction clips in `audio_mp3/`, named exactly `01.mp3` through
`10.mp3`, plus `audio_mp3.zip` when the local tooling permits it.

## Voice and synthesis

Use the existing production Piper preset: model `en_GB-semaine-medium`, speaker
`prudence` (speaker ID 0), with no alternate TTS voice. Prefer the configured
TTS service; if it is unavailable, invoke the same pinned local Piper model
directly. Each synthesis input contains exactly one requested utterance and no
file number or explanatory text.

## Audio post-processing

For every generated clip, trim leading and trailing silence, then encode as
mono MP3 at 22,050 Hz and 32 kbps CBR. Preserve enough padding for a natural
onset/decay while removing excessive silence. Output files are kept short and
are written only under `audio_mp3/`.

## Verification

Verify all ten files exist with exact names, are valid MP3 files, are mono,
22,050 Hz, and 32 kbps CBR. Probe duration and decode each file with FFmpeg to
confirm it can be read. Print each file's byte size and create the ZIP archive
with the ten MP3s at its root.

## Failure handling

If the configured service cannot be reached, use the pinned local Piper asset.
If neither path is available, stop without substituting a different voice and
report the missing runtime dependency. Do not alter existing application code
or the production voice configuration.

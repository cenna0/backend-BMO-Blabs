# Voice and Device Settings

> **HISTORICAL TARGET SNAPSHOT — NOT CURRENT DEPLOYMENT STATUS**
> Current Backend status is in integration `05`; physical settings application
> remains `PENDING_PHYSICAL_ESP`.

## Existing verified behavior

- Piper Prudence is the only production TTS engine; synthesis failure returns
  `TTS_FAILED`.
- Private P9.1 stores user `language`, `responseLength`, `automaticMemoryCandidates`, and fixed `Asia/Jakarta` timezone.
- Private P9.1 stores device display/default, playback volume, quiet hours, notification behavior, fixed Prudence profile, speech speed, and enabled state.
- These DB settings are not currently applied to the production physical voice pipeline or ESP.

## Frozen target

- Preserve user/device settings routes and validation while activating them in the production Backend API.
- Initial physical settings synchronization sends playback volume only; further fields require explicit capability/version decisions.
- An ESP acknowledgement records application, but PostgreSQL remains desired-state truth.
- Do not dynamically switch production TTS models or upload/clone voices in this scope.
- Voice preview is `DEFERRED`.

Physical application remains `PENDING_PHYSICAL_ESP`.

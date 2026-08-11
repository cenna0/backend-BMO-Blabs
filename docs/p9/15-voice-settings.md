# Voice and Device Settings

## Existing verified behavior

- Piper Prudence is production primary; Kokoro `af_heart` speed `0.80` is fallback; RVC is disabled.
- Private P9.1 stores user `language`, `responseLength`, `automaticMemoryCandidates`, and fixed `Asia/Jakarta` timezone.
- Private P9.1 stores device display/default, playback volume, quiet hours, notification behavior, fixed Prudence profile, speech speed, and enabled state.
- These DB settings are not currently applied to the production physical voice pipeline or ESP.

## Frozen target

- Preserve user/device settings routes and validation while activating them in the production Backend API.
- Initial physical settings synchronization sends playback volume only; further fields require explicit capability/version decisions.
- An ESP acknowledgement records application, but PostgreSQL remains desired-state truth.
- Do not dynamically switch production TTS models, upload/clone voices, or enable RVC in this scope.
- Voice preview is `DEFERRED`.

Physical application remains `PENDING_PHYSICAL_ESP`.

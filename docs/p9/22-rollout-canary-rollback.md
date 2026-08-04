# Rollout, Canary, and Rollback

**Status:** `PROPOSED`

## Rollout sequence

```text
reviewed docs/schema/API
 → build immutable image
 → static/tests/security/docs verification
 → backup + record previous commit/schema
 → migration rehearsal on isolated restore
 → private canary with feature flags off
 → targeted authenticated canary
 → health/resource/contract checks
 → gradual feature enablement
 → evidence and stop gate
```

No P9 feature is enabled merely because its code or schema exists.

## Feature flags

Use independent gates for auth/pairing, chat persistence, memory candidates,
scheduler worker, proactive device delivery, Spotify actions, WhatsApp sends,
and editable voice settings. Default new flags to off. Read-only status and
export paths may be enabled before writes only after privacy review.

## Canary cohorts

- local/unit fixtures;
- private integration environment with sanitized data;
- one controlled user/device;
- limited mobile/API traffic;
- only then broader activation after the relevant acceptance matrix passes.

Scheduled device delivery must remain disabled until the additive hardware
contract is approved and capability negotiation exists.

## Rollback triggers

- core voice/auth health regression;
- cross-user data exposure or secret leak;
- duplicate schedule execution or outbound send;
- failed deletion/export or restore check;
- host reserve breach, OOM, restart loop, or unbounded backlog;
- provider policy/credential failure without safe degradation.

Rollback pauses optional workers/actions, turns flags off, restores the last
known-good application image/config, and keeps data for forensic/recovery
review. A DB restore is a separate controlled decision; an application
rollback never silently deletes records.

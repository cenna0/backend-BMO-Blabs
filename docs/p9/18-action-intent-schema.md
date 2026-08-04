# Hermes ↔ Backend Action-Intent Schema

**Status:** `PROPOSED`

Hermes proposes; Backend authenticates, authorizes, validates, confirms, and
executes. The action schema is versioned and discriminated so unsupported
actions fail closed.

## Envelope

```json
{
  "schema_version": "1",
  "intent_id": "<uuid>",
  "kind": "spotify.playback",
  "requested_confirmation": "none|user_required",
  "idempotency_key": "<opaque-key>",
  "expires_at": "<iso-8601>",
  "payload": {}
}
```

Hermes does not provide `user_id`, provider tokens, device secrets, SQL, URLs
to internal services, or arbitrary code. Backend binds the current authenticated
principal and rejects a mismatched or expired context.

## Initial discriminated payloads

```ts
type ActionIntent =
  | { kind: "spotify.playback"; payload: {
      command: "PLAY" | "PAUSE" | "RESUME" | "NEXT" | "PREVIOUS";
      query?: string;
      deviceId?: string;
    }}
  | { kind: "spotify.volume"; payload: { volume: number; deviceId?: string } }
  | { kind: "whatsapp.send"; requested_confirmation: "user_required"; payload: {
      recipientRef: string; message: string;
    }}
  | { kind: "schedule.create"; requested_confirmation: "user_required"; payload: {
      name: string; timezone: string; schedule: object; target: object;
    }}
  | { kind: "device.speech"; requested_confirmation: "user_required"; payload: {
      deviceId: string; text: string;
    }};
```

The final implementation uses strict schemas, length limits, allowlists,
provider/device ownership checks, per-kind confirmation requirements, and
safe result types. It never evaluates arbitrary `schedule` or provider input
as code. Schedule intents use the server-enforced `Asia/Jakarta` timezone;
clients cannot select a different timezone in the initial product.

## Result envelope

```json
{
  "intent_id": "<uuid>",
  "status": "ACCEPTED|CONFIRMATION_REQUIRED|SUCCEEDED|FAILED|EXPIRED",
  "result_code": "<stable-code>",
  "summary": "<safe short text>",
  "provider_reference": null
}
```

Provider references are opaque and may be omitted. Raw errors and credentials
do not cross the boundary.

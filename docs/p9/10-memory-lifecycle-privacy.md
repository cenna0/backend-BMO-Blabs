# Memory Lifecycle and Privacy

**Status:** `READY_TO_IMPLEMENT`

Chat history, memory, schedules, and provider conversations are separate domains. Chat does not become memory automatically.

```text
message -> policy/redaction -> candidate -> user/policy accept|reject
        -> curated MemoryRecord -> edit|expire|delete|forget-topic|clear-all
```

- Backend and `MemoryGateway` own memory policy/storage; Hermes receives only bounded relevant context.
- Sensitive credentials, DOB, provider tokens, Wi-Fi passwords, raw audio, and unrequested WhatsApp content are ineligible.
- Every mutation is user-scoped, auditable, idempotent where retried, and reflected in export/deletion.
- Clear-all and forget-topic must prevent resurfacing, not merely hide UI rows.
- Retention defaults and legal audit floor remain explicit product/privacy gates in `25-unresolved-decisions.md`.

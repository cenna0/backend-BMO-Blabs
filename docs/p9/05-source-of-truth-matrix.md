# P9 Data Ownership and Source-of-Truth Matrix

**Status:** `LOCKED + PROPOSED`

| Data | Source of truth | Read consumers | Retention/deletion owner | Notes |
|---|---|---|---|---|
| User identity/profile | PostgreSQL via Backend | Mobile, Backend, audit | User/Backend | Provider identity is linked, not authoritative |
| Login/session state | PostgreSQL/secure session store | Backend | Backend/session expiry | Access token is short-lived; only opaque refresh-token hashes are persisted |
| Device ownership/pairing | PostgreSQL via Backend | Mobile, Backend, device adapter | User/Backend | Device secret is out-of-band and hashed/rotated |
| User settings | PostgreSQL via Backend | Backend, mobile, Hermes context adapter | User/Backend | Language, response length, automatic candidates, server-enforced `Asia/Jakarta` |
| Device settings | PostgreSQL via Backend | Backend, mobile, device/audio adapter | User/Backend | Display/default device, volume, quiet hours, notifications, Prudence, speed |
| Chat sessions/messages | PostgreSQL via Backend | Mobile, Backend, scoped Hermes context | User/Backend | All valid text and voice transcripts; not memory by default |
| Long-term memory | PostgreSQL via `MemoryGateway` | Backend/Hermes context, mobile review | User/Backend | Curated records only; editable/deletable |
| Memory candidates | PostgreSQL via Backend | Mobile, review workflow | User/Backend | Candidate is not memory until accepted/auto-policy-approved |
| Schedules/runs/attempts | PostgreSQL via Backend/worker | Worker, mobile, audit | User/Backend | Structured records; never memory |
| Spotify connection metadata | PostgreSQL via Backend | Mobile, Spotify adapter | User/Backend | Tokens encrypted; plaintext never leaves adapter |
| Spotify access/refresh tokens | Encrypted secret field/key boundary | Spotify adapter only | User/Backend/provider revoke | Key rotation and revocation required |
| WhatsApp rules/audit | PostgreSQL via Backend | Mobile, WhatsApp adapter | User/Backend | Session bytes stay with Hermes persistent volume |
| WhatsApp session | Hermes-owned persistent volume | Hermes gateway | Hermes/operator | Not copied into PostgreSQL or memory |
| Hermes conversation context | Hermes runtime | Hermes | Hermes policy | Not durable chat history; Backend persists its own messages |
| Raw WAV input | Temporary backend/audio storage | Audio pipeline | Backend cleanup | Never permanent chat history |
| Generated MP3 | Temporary backend/audio storage | Device playback | Backend TTL/playback cleanup | Never permanent chat history |
| Provider search results | Provider/short-lived action result | Backend/Hermes/mobile | Request lifecycle | Not automatic memory |
| Hardware protocol | HW Contract v1.0.5 | Firmware/backend | Contract governance | P9 proposal may be additive vNext only; no P9.1 change |
| Backup artifact | Encrypted backup store | Recovery operator | Backup policy | Restore must be tested |

## Conflict rule

If two stores disagree, Backend resolves according to this matrix and records
an audit event. Markdown/Obsidian exports are derived snapshots; imports remain
disabled until a validated identity/conflict process is approved.

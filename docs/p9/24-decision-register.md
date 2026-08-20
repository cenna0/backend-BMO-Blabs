# P9 Decision Register — Historical Summary

> **SUPERSEDED SUMMARY — DO NOT IMPLEMENT STALE PAIRING/STATUS ROWS**
> Current decisions are in `docs/integration/06-DECISION-REGISTER.md`; code-only
> pairing supersedes the five-attempt/four-field-era model below.

**Canonical integration decisions:** [`../integration/06-DECISION-REGISTER.md`](../integration/06-DECISION-REGISTER.md)

| Decision | State |
|---|---|
| PostgreSQL/Prisma is durable BMO application storage | Frozen; existing P9.1 candidate |
| One Backend API service owns mobile/device application APIs | Frozen target |
| v1.0.5 device voice remains immutable | Frozen existing |
| Mobile `/api/v1/ws` is separate from device `/ws` | Frozen target |
| Registration becomes self-service with required DOB for MVP recovery | Frozen target; supersedes invite-only product decision while retaining invitation data |
| Pairing remains six digits/600 seconds/five attempts/mobile bearer | Frozen existing |
| Physical owner binding uses hardware ID plus token verifier | Frozen target |
| PostgreSQL-backed curated memory; chat is not automatic memory | Frozen target |
| Scheduler is structured data; proactive delivery is generic | Frozen target |
| Wi-Fi desired state is encrypted in DB; ESP applies it | Frozen target / physical pending |
| Spotify uses server-side Authorization Code and Backend-owned tokens/actions | Frozen target / live blocked |
| Hermes owns WhatsApp session; Backend owns BMO policy/audit | Frozen target / bridge contract source-verified, live session blocked |
| Additive migrations; no Phase 1 production migration | Frozen |
| Provider/physical capability is not acceptance evidence | Frozen |

Older P9 decision rows remain historical context in Git. If a decision above changes, add a dated superseding entry to the integration register rather than silently editing its meaning.

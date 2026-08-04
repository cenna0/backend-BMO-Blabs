# P9 Unresolved Decisions

**Status:** `OPEN`

These are the smallest decisions that must be closed before the affected
implementation prompt is authorized. They are not hidden assumptions.

| Decision | Why it matters | Required owner | Due phase |
|---|---|---|---|
| Off-VPS backup destination | determines final disaster-recovery location and key boundary | operations | P9.6 |
| Production email delivery and password-reset strategy | determines invite/recovery operations without adding an unapproved provider | product/security | P9.1/P9.6 |
| Final mobile pairing copy and visual design | determines user-facing presentation of locked pairing mechanics | product/mobile | P9.1 |
| Default chat retention and purge delay | determines user privacy and storage budget | product/privacy | P9.2 |
| Memory candidate default approval policy | determines whether candidates need review by default | product/privacy | P9.2 |
| Sensitive-content classifier policy | determines what candidate extraction rejects | product/privacy | P9.2 |
| Exact FTS language/configuration | determines tokenization/ranking for mixed language | SW | P9.2 |
| pgvector extension and embedding trigger | determines later schema/index cost | SW/operations | P9.2/P9.6 |
| Export JSON/Markdown format | determines compatibility and portability | product/SW | P9.2 |
| Schedule recurrence grammar | determines validation and DST behavior | product/SW | P9.3 |
| Missed-run defaults and maximum retry window | determines user expectations and load | product/SW | P9.3 |
| Future scheduler worker selection | determines dependency and operational behavior | SW/operations | P9.3 |
| Future hardware scheduled-audio payloads | determines firmware implementation and capability negotiation | SW + HW | P9.3 |
| ESP32 offline alarm storage/clock limits | determines fallback bundle and hardware resource use | HW | P9.3/P10 |
| Spotify OAuth flow, approved scopes, and provider policy | can change provider eligibility and consent | SW/security | P9.4 |
| Spotify action confirmation matrix | separates harmless controls from consequential actions | product/privacy | P9.4 |
| WhatsApp gateway API/version and session recovery contract | Hermes boundary is not yet a documented mobile API | SW/Hermes owner | P9.5 |
| WhatsApp message-body retention for confirmed sends | balances auditability and privacy | product/privacy | P9.5 |
| Application key-management mechanism | determines token encryption and rotation operations | security/operations | P9.1/P9.6 |
| Exact single-VPS container caps | requires live resource/load evidence | operations | P9.6 |
| Account-deletion legal/audit retention floor | determines irreversible deletion workflow | product/privacy | P9.6 |

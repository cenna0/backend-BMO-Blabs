# Chat Retention and Deletion

**Status:** `PROPOSED + OPEN POLICY VALUES`

## Stored history

Store every valid text chat message and every voice transcript associated with
an authenticated user/device. Store role, kind, content, session, timestamps,
and safe provenance. Do not store raw WAV or generated MP3 as permanent chat
history. Chat history does not automatically become long-term memory.

## Deletion semantics

- Session deletion hides/removes the session and its messages according to the
  approved retention mode; it does not imply memory deletion unless the user
  confirms it.
- Message deletion removes it from normal retrieval and creates an auditable
  deletion action. Any linked memory candidate is rejected or re-evaluated.
- User “clear chat” removes all user chat sessions/messages but preserves only
  explicitly retained security/audit metadata.
- User “clear memories” operates through `MemoryGateway` and does not delete
  chat history.
- Account deletion is a staged workflow: revoke credentials, disable delivery,
  disconnect providers, cancel schedules, delete/export content, then retain
  minimal required audit data.

## Retention policy decisions

The following values are OPEN and must be approved before P9.2 migration:

| Item | Required decision |
|---|---|
| Default chat retention | duration or indefinite user-controlled retention |
| Deleted-content purge delay | immediate hard delete or bounded recovery window |
| Audit retention | minimum operational/security period |
| Export format | JSON only, JSON + Markdown, or both |
| Provider webhook/event retention | minimal metadata duration |

Until approved, implementation must not invent a silent purge period.

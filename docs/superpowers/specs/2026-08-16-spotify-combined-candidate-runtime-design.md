# Spotify Combined Candidate Runtime Design

**Status:** Approved for repository changes only

## Goal

Make the Spotify candidate runbook reproducible without dropping the existing
WhatsApp identity-resolver composition or changing any runtime state.

## Canonical environment

The persistent Compose environment path is:

```text
/opt/bmo/config/p9.1/compose.env
```

It is seeded later, only by an operator-authorized `install` command from the
existing `/tmp/bmo-p9-1-validation-20260804/compose.env`. The target directory
is `bmo-admin:bmo-admin` mode `0700`; the file is
`bmo-admin:bmo-admin` mode `0600`. The repository never stores the file.

## Compose matrix

The canonical base file is always `p9.1-compose.yml`.

| Operation | Compose files | Reason |
|---|---|---|
| Sanitized config render | base + WhatsApp resolver + Spotify secrets | Proves the combined Backend composition preserves both providers. |
| PostgreSQL start | base only | Provider overrides are irrelevant to PostgreSQL and would unnecessarily require provider secret paths. |
| Prisma migration | base only | The one-shot Prisma process needs only the database/password wiring; it does not execute provider runtime behavior. |
| Backend recreation | base + WhatsApp resolver + Spotify secrets | The long-lived candidate must retain both resolver and Spotify wiring. |

The WhatsApp override remains unchanged. The Spotify callback remains fixed at
`http://127.0.0.1:4310/api/v1/integrations/spotify/callback`, and Backend remains
on host loopback `127.0.0.1:3010`.

## Safety and verification

`ops/spotify/verify-candidate-env.sh` checks the canonical env path and its
mode without reading or printing contents. Existing Spotify secret-file
verification remains separate. Regression tests inspect both overrides and the
runbook command matrix, proving that Spotify Backend recreation includes the
WhatsApp resolver URL, token-file variable, and secret mount.

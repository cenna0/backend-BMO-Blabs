#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_ENV_FILE='/opt/bmo/config/p9.1/compose.env'
readonly EXPECTED_OWNER='bmo-admin:bmo-admin'

if [[ "${P9_COMPOSE_ENV_FILE:-}" != "$EXPECTED_ENV_FILE" ]]; then
  printf '%s\n' 'Candidate Compose env path contract failed' >&2
  exit 64
fi

if [[ -L "$EXPECTED_ENV_FILE" || ! -f "$EXPECTED_ENV_FILE" || ! -r "$EXPECTED_ENV_FILE" || ! -s "$EXPECTED_ENV_FILE" ]]; then
  printf '%s\n' 'Candidate Compose env file must be a readable, non-empty regular file' >&2
  exit 64
fi

mode="$(stat -c '%a' -- "$EXPECTED_ENV_FILE")"
mode_value=$((8#$mode))
if (( (mode_value & 0177) != 0 || (mode_value & 07000) != 0 )); then
  printf '%s\n' 'Candidate Compose env file must be mode 0600 or stricter' >&2
  exit 64
fi

if [[ "$(stat -c '%U:%G' -- "$EXPECTED_ENV_FILE")" != "$EXPECTED_OWNER" ]]; then
  printf '%s\n' 'Candidate Compose env file owner contract failed' >&2
  exit 64
fi

printf '%s\n' 'Candidate Compose env-file contract: PASS'

#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_CALLBACK='http://127.0.0.1:4310/api/v1/integrations/spotify/callback'

if [[ "${SPOTIFY_CALLBACK_URL:-}" != "$EXPECTED_CALLBACK" ]]; then
  printf '%s\n' 'Spotify candidate callback contract failed' >&2
  exit 64
fi

check_secret_file() {
  local variable_name="$1"
  local path="${!variable_name-}"
  local mode
  local mode_value

  if [[ -z "$path" ]]; then
    printf '%s\n' "${variable_name} is required" >&2
    exit 64
  fi
  if [[ -L "$path" || ! -f "$path" || ! -r "$path" || ! -s "$path" ]]; then
    printf '%s\n' "${variable_name} must name a readable, non-empty regular file" >&2
    exit 64
  fi

  mode="$(stat -c '%a' -- "$path")"
  mode_value=$((8#$mode))
  if (( (mode_value & 0177) != 0 || (mode_value & 07000) != 0 )); then
    printf '%s\n' "${variable_name} must be mode 0600 or stricter" >&2
    exit 64
  fi
}

check_secret_file SPOTIFY_CLIENT_ID_FILE
check_secret_file SPOTIFY_CLIENT_SECRET_FILE
check_secret_file SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE

printf '%s\n' 'Spotify candidate secret-file contract: PASS'

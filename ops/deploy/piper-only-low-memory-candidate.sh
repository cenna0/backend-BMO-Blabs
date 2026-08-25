#!/usr/bin/env bash
set -Eeuo pipefail

# Controlled, fail-closed Piper-only candidate validation.
#
# This script is intentionally separate from production Compose. It may start
# only the project named below and never calls a production compose project.
# It does not migrate a candidate database, promote an image, purge artifacts,
# or remove candidate volumes/images.

readonly ROOT_DIR="/opt/bmo/app"
readonly PROJECT="bmo-piper-only-candidate"
readonly P9_COMPOSE_ENV_FILE="${P9_CANDIDATE_ENV_FILE:-/opt/bmo/config/p9.1/compose.env}"
readonly AUDIO_ENV_FILE_PATH="${AUDIO_ENV_FILE:-/opt/bmo/config/audio.env}"
readonly COMPOSE_BASE="${ROOT_DIR}/p9.1-compose.yml"
readonly COMPOSE_OVERLAY="${ROOT_DIR}/ops/deploy/piper-only-candidate-compose.yml"
readonly CANDIDATE_BACKEND_IMAGE="${P9_CANDIDATE_IMAGE:-bmo-p9.1-candidate@sha256:71011f1b2ee10852774bddd1bd03dd6ae0f7a66eea1e190e1c4981023792efe0}"
readonly CANDIDATE_AUDIO_IMAGE="${AUDIO_CANDIDATE_IMAGE:-bmo-audio@sha256:24e1c4244ea8868f731d819ea75cb57c1e464b6df3bd9679d65fd4711643488c}"
readonly PRODUCTION_AUDIO_CONTAINER="${PRODUCTION_AUDIO_CONTAINER:-bmo-production-audio-1}"
readonly MIN_AVAILABLE_BYTES=$((4 * 1024 * 1024 * 1024))
readonly EMERGENCY_AVAILABLE_BYTES=$((1536 * 1024 * 1024))
readonly WAIT_SECONDS="${PIPER_CANDIDATE_WAIT_SECONDS:-240}"
readonly FULL_PIPELINE="${PIPER_CANDIDATE_FULL_PIPELINE:-1}"
readonly WAV_INPUT="${PIPER_CANDIDATE_WAV:-}"
readonly EVIDENCE_DIR="${PIPER_CANDIDATE_EVIDENCE_DIR:-/opt/bmo/data/piper-only-candidate-evidence-$(date -u +%Y%m%dT%H%M%SZ)}"

export P9_CANDIDATE_IMAGE="$CANDIDATE_BACKEND_IMAGE"
export AUDIO_CANDIDATE_IMAGE="$CANDIDATE_AUDIO_IMAGE"
export AUDIO_ENV_FILE="$AUDIO_ENV_FILE_PATH"

mkdir -p "$EVIDENCE_DIR"
chmod 700 "$EVIDENCE_DIR"

readonly LOG_FILE="$EVIDENCE_DIR/run.log"
readonly TOKEN_FILE="$(mktemp /dev/shm/piper-only-audio-token.XXXXXX)"
chmod 600 "$TOKEN_FILE"

candidate_started=0
active_child=""
cleanup_done=0

compose=(
  docker compose
  --project-name "$PROJECT"
  --env-file "$P9_COMPOSE_ENV_FILE"
  -f "$COMPOSE_BASE"
  -f "$COMPOSE_OVERLAY"
)

log() {
  local message="$1"
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$message" | tee -a "$LOG_FILE"
}

mem_available_bytes() {
  awk '/^MemAvailable:/ { print $2 * 1024; exit }' /proc/meminfo
}

record_snapshot() {
  local name="$1"
  {
    echo "timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo '--- free -b ---'
    free -b
    echo '--- docker stats ---'
    docker stats --no-stream || true
    echo '--- process RSS ---'
    ps -eo pid,ppid,user,comm,%cpu,%mem,rss,vsz,etime,args --sort=-rss | head -40
    echo '--- candidate containers ---'
    "${compose[@]}" ps -a || true
    echo '--- candidate inspect state ---'
    for service in postgres backend audio; do
      cid=$("${compose[@]}" ps -q "$service" 2>/dev/null || true)
      if [[ -n "$cid" ]]; then
        docker inspect "$cid" --format '{{.Name}} image={{.Image}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restart={{.RestartCount}} oom_killed={{.State.OOMKilled}}' || true
      fi
    done
    echo '--- production protected state ---'
    for container in bmo-production-p9-backend-1 bmo-production-p9-postgres-1 bmo-production-audio-1; do
      docker inspect "$container" --format '{{.Name}} id={{.Id}} image={{.Image}} status={{.State.Status}} restart={{.RestartCount}} oom_killed={{.State.OOMKilled}}' || true
    done
  } > "$EVIDENCE_DIR/${name}.txt"
}

production_state() {
  for container in bmo-production-p9-backend-1 bmo-production-p9-postgres-1 bmo-production-audio-1; do
    docker inspect "$container" --format '{{.Id}} {{.Image}} {{.State.Status}} {{.RestartCount}} {{.State.OOMKilled}}'
  done
}

assert_production_unchanged() {
  local current
  current="$(production_state)"
  if [[ "$current" != "$production_baseline" ]]; then
    log 'PRODUCTION_CHANGED: protected production container identity/state differs from baseline'
    printf '%s\n' "$current" > "$EVIDENCE_DIR/production-changed.txt"
    return 1
  fi
}

candidate_state_is_safe() {
  local service cid restart oom
  for service in postgres backend audio; do
    cid=$("${compose[@]}" ps -q "$service" 2>/dev/null || true)
    [[ -z "$cid" ]] && continue
    read -r restart oom < <(docker inspect "$cid" --format '{{.RestartCount}} {{.State.OOMKilled}}')
    if [[ "$oom" == 'true' || "$restart" != '0' ]]; then
      log "CANDIDATE_RESOURCE_PRESSURE: service=$service restart=$restart oom_killed=$oom"
      return 1
    fi
  done
}

host_memory_pressure_is_safe() {
  [[ -r /proc/pressure/memory ]] || return 0
  awk '
    $1 == "some" { for (i = 2; i <= NF; i++) if ($i ~ /^avg10=/) { sub(/^avg10=/, "", $i); if (($i + 0) > 0) exit 1 } }
    $1 == "full" { for (i = 2; i <= NF; i++) if ($i ~ /^avg10=/) { sub(/^avg10=/, "", $i); if (($i + 0) > 0) exit 1 } }
  ' /proc/pressure/memory
}

assert_emergency_gate() {
  local available
  available="$(mem_available_bytes)"
  log "post-start MemAvailable=${available} bytes"
  if (( available < EMERGENCY_AVAILABLE_BYTES )); then
    log "BLOCKED_RESOURCE: MemAvailable below emergency floor (${EMERGENCY_AVAILABLE_BYTES} bytes)"
    return 1
  fi
  candidate_state_is_safe
}

wait_for_memory_pressure_clear() {
  local deadline=$(( $(date +%s) + 60 ))

  if host_memory_pressure_is_safe; then
    return 0
  fi

  log 'candidate memory PSI is transiently non-zero; allowing up to 60s to recover'

  while ! host_memory_pressure_is_safe; do
    assert_emergency_gate || return 1

    if (( $(date +%s) >= deadline )); then
      cat /proc/pressure/memory > "$EVIDENCE_DIR/memory-pressure-timeout.txt" 2>/dev/null || true
      log 'BLOCKED_RESOURCE: host PSI memory pressure did not clear within 60s'
      return 1
    fi

    sleep 5
  done

  log 'candidate memory PSI returned to zero'
}

stop_candidates() {
  if (( candidate_started == 1 )); then
    log 'stopping candidate services only'
    "${compose[@]}" stop --timeout 20 audio backend postgres >/dev/null 2>&1 || true
  fi
}

on_exit() {
  local status=$?
  if (( cleanup_done == 1 )); then
    return "$status"
  fi
  cleanup_done=1
  if [[ -n "$active_child" ]] && kill -0 "$active_child" 2>/dev/null; then
    kill "$active_child" 2>/dev/null || true
    wait "$active_child" 2>/dev/null || true
  fi
  stop_candidates
  record_snapshot candidate-after
  rm -f "$TOKEN_FILE"
  if (( status == 0 )); then
    log "candidate validation completed; services stopped; evidence=$EVIDENCE_DIR"
  else
    log "candidate validation aborted with status=$status; evidence=$EVIDENCE_DIR"
  fi
  return "$status"
}
trap on_exit EXIT

record_snapshot baseline
production_baseline="$(production_state)"

production_audio_digest="$(docker inspect "$PRODUCTION_AUDIO_CONTAINER" --format '{{.Image}}')"
printf 'production_audio_digest=%s\ncandidate_audio_digest=%s\n' \
  "$production_audio_digest" "$CANDIDATE_AUDIO_IMAGE" > "$EVIDENCE_DIR/promotion-digests.txt"
log "recorded production/candidate audio digests in $EVIDENCE_DIR/promotion-digests.txt"

if [[ ! -f "$P9_COMPOSE_ENV_FILE" || ! -f "$AUDIO_ENV_FILE_PATH" ]]; then
  log 'BLOCKED_CONFIG: candidate env file is missing'
  exit 78
fi
if [[ ! -f "$COMPOSE_BASE" || ! -f "$COMPOSE_OVERLAY" ]]; then
  log 'BLOCKED_CONFIG: candidate compose file is missing'
  exit 78
fi
if [[ -z "$WAV_INPUT" || ! -f "$WAV_INPUT" ]]; then
  log 'BLOCKED_INPUT: PIPER_CANDIDATE_WAV must point to a real speech WAV fixture'
  exit 78
fi

if docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" | grep -q .; then
  log "BLOCKED_STATE: candidate project $PROJECT already has containers; refusing to touch unknown state"
  exit 78
fi
if ss -ltnH | awk '$4 ~ /:8002$/ || $4 ~ /:3010$/ { found = 1 } END { exit(found ? 0 : 1) }'; then
  log 'BLOCKED_PORT: candidate port 8002 or 3010 is already listening'
  exit 78
fi

config_json="$("${compose[@]}" config --format json)"
printf '%s' "$config_json" | python3 -c '
import json, sys
cfg = json.load(sys.stdin)
services = cfg["services"]
audio = services["audio"]
backend = services["backend"]
assert audio["image"] == __import__("os").environ["AUDIO_CANDIDATE_IMAGE"]
assert backend["image"] == __import__("os").environ["P9_CANDIDATE_IMAGE"]
assert "70" in {str(x) for x in backend.get("group_add", [])}
assert backend["environment"]["AUDIO_SERVICE_URL"] == "http://127.0.0.1:8002"
assert audio["environment"]["AUDIO_SERVICE_PORT"] == "8001"
assert audio["environment"]["MODEL_DOWNLOAD_ALLOWED"].lower() == "false"
assert audio["environment"]["HF_HUB_OFFLINE"] == "1"
assert audio["environment"]["TRANSFORMERS_OFFLINE"] == "1"
assert audio["environment"]["ORT_DISABLE_ALL_NETWORK"] == "1"
audio_ports = audio.get("ports", [])
assert len(audio_ports) == 1
assert str(audio_ports[0]["published"]) == "8002"
assert int(audio_ports[0]["target"]) == 8001
assert audio_ports[0].get("host_ip") == "127.0.0.1"
for service in services.values():
    for port in service.get("ports", []):
        assert str(port["published"]) not in {"3000", "8001"}
for volume in audio.get("volumes", []):
    target = volume.get("target", "")
    if target.startswith(("/opt/bmo/models", "/opt/bmo/cache/audio")):
        assert volume.get("read_only") is True
assert audio.get("restart") == "no"
assert backend.get("restart") == "no"
'

if (( $(mem_available_bytes) < MIN_AVAILABLE_BYTES )); then
  log "BLOCKED_RESOURCE: pre-start MemAvailable=$(mem_available_bytes) bytes; required=${MIN_AVAILABLE_BYTES} bytes"
  exit 75
fi
candidate_started=1
log "starting candidate audio image=$CANDIDATE_AUDIO_IMAGE on 127.0.0.1:8002"
"${compose[@]}" up -d --no-build --pull never --no-deps audio

audio_deadline=$(( $(date +%s) + WAIT_SECONDS ))
while :; do
  code=$(curl --max-time 3 -sS -o "$EVIDENCE_DIR/audio-livez.json" -w '%{http_code}' http://127.0.0.1:8002/livez || true)
  if [[ "$code" == '200' ]] && python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status") == "ok")' "$EVIDENCE_DIR/audio-livez.json" | grep -q True; then
    break
  fi
  (( $(date +%s) >= audio_deadline )) && { log 'BLOCKED_HEALTH: candidate audio /livez timeout'; exit 76; }
  sleep 2
done

ready_deadline=$(( $(date +%s) + WAIT_SECONDS ))
while :; do
  code=$(curl --max-time 3 -sS -o "$EVIDENCE_DIR/audio-readyz.json" -w '%{http_code}' http://127.0.0.1:8002/readyz || true)
  if [[ "$code" == '200' ]] && python3 -c 'import json,sys; x=json.load(open(sys.argv[1])); print(x.get("status") == "ok" and x.get("stt_loaded") is True and x.get("piper_loaded") is True and x.get("ffmpeg_available") is True)' "$EVIDENCE_DIR/audio-readyz.json" | grep -q True; then
    break
  fi
  (( $(date +%s) >= ready_deadline )) && { log 'BLOCKED_HEALTH: candidate audio /readyz timeout or invalid Piper contract'; exit 76; }
  sleep 2
done

assert_emergency_gate
wait_for_memory_pressure_clear || exit 75
candidate_state_is_safe

internal_token="$(awk -F= '$1 == "INTERNAL_SERVICE_TOKEN" { sub(/^[^=]*=/, ""); print; exit }' "$AUDIO_ENV_FILE_PATH")"
if [[ -z "$internal_token" ]]; then
  log 'BLOCKED_CONFIG: INTERNAL_SERVICE_TOKEN missing from audio env file'
  exit 78
fi
printf '%s\n' "$internal_token" > "$TOKEN_FILE"

run_monitored() {
  local log_name="$1"
  shift
  local command_log="$EVIDENCE_DIR/${log_name}.log"
  "$@" > "$command_log" 2>&1 &
  active_child=$!
  while kill -0 "$active_child" 2>/dev/null; do
    assert_emergency_gate || { kill "$active_child" 2>/dev/null || true; wait "$active_child" 2>/dev/null || true; active_child=""; exit 75; }
    sleep 5
  done
  if ! wait "$active_child"; then
    active_child=""
    log "validation command failed: $log_name; see $command_log"
    exit 77
  fi
  active_child=""
  wait_for_memory_pressure_clear || exit 75
}

run_monitored audio-real-stt-piper-ffmpeg \
  python3 "$ROOT_DIR/audio-service/scripts/verify_voice_pipeline.py" \
  --base-url http://127.0.0.1:8002 \
  --token-file "$TOKEN_FILE" \
  --wav "$WAV_INPUT" \
  --output "$EVIDENCE_DIR/candidate-audio.mp3" \
  --report "$EVIDENCE_DIR/audio-real-pipeline.json"

if [[ "$FULL_PIPELINE" == '1' ]]; then
  log 'starting candidate PostgreSQL/backend only after audio validation'
  "${compose[@]}" up -d --no-build --pull never postgres
  postgres_deadline=$(( $(date +%s) + WAIT_SECONDS ))
  while :; do
    postgres_id=$("${compose[@]}" ps -q postgres)
    postgres_health=$(docker inspect "$postgres_id" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}')
    [[ "$postgres_health" == 'healthy' ]] && break
    (( $(date +%s) >= postgres_deadline )) && { log 'BLOCKED_HEALTH: candidate PostgreSQL health timeout'; exit 76; }
    sleep 2
  done
  assert_emergency_gate
  "${compose[@]}" up -d --no-build --pull never --no-deps backend
  backend_deadline=$(( $(date +%s) + WAIT_SECONDS ))
  while :; do
    code=$(curl --max-time 3 -sS -o "$EVIDENCE_DIR/candidate-backend-livez.json" -w '%{http_code}' http://127.0.0.1:3010/livez || true)
    if [[ "$code" == '200' ]] && python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status") == "ok")' "$EVIDENCE_DIR/candidate-backend-livez.json" | grep -q True; then break; fi
    (( $(date +%s) >= backend_deadline )) && { log 'BLOCKED_HEALTH: candidate backend /livez timeout'; exit 76; }
    sleep 2
  done
  code=$(curl --max-time 10 -sS -o "$EVIDENCE_DIR/candidate-backend-readyz.json" -w '%{http_code}' http://127.0.0.1:3010/readyz || true)
  if [[ "$code" != '200' ]]; then
    log 'BLOCKED_HEALTH: candidate backend /readyz is not healthy; refusing full-pipeline test'
    exit 76
  fi
  assert_emergency_gate
  candidate_device_token="$(printf '%s' "$config_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["backend"]["environment"].get("DEVICE_TOKEN", ""))')"
  candidate_device_id="$(printf '%s' "$config_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["backend"]["environment"].get("DEVICE_ID", "bmo-001"))')"
  if [[ -z "$candidate_device_token" ]]; then
    log 'BLOCKED_CONFIG: candidate DEVICE_TOKEN is unavailable'
    exit 78
  fi
  run_monitored candidate-backend-hermes-fake-esp \
    env \
    BMO_BASE_URL=http://127.0.0.1:3010 \
    DEVICE_ID="$candidate_device_id" \
    DEVICE_TOKEN="$candidate_device_token" \
    FAKE_ESP32_WAV_PATH="$WAV_INPUT" \
    FAKE_ESP32_OUTPUT_MP3_PATH="$EVIDENCE_DIR/fake-esp.mp3" \
    FAKE_ESP32_TIMEOUT_MS=240000 \
    npm --prefix "$ROOT_DIR/backend" run fake-esp32
fi

assert_production_unchanged
candidate_state_is_safe
log "PASS: candidate audio/full pipeline evidence=$EVIDENCE_DIR"

# P8 Piper Prudence Feasibility Design

**Status:** approved by the operator's P8 Prompt 4 execution specification

## Goal and boundary

Evaluate Piper `en_GB-semaine-medium`, speaker `prudence` / ID `0`, beside the
unchanged P7 production stack. The candidate is private, CPU-only, offline at
runtime, bounded by a cgroup, and removed after measurement. It never binds a port,
receives a production secret, modifies Compose, or replaces Kokoro during this
prompt.

## Approaches considered

1. **Persistent Python API worker (selected).** Load `PiperVoice` once in an isolated
   child process, exchange bounded JSON-lines requests over stdin/stdout, write WAV to
   a dedicated output mount, then validate and convert it with FFmpeg. This directly
   measures the production-shaped warm architecture and gives the controller a clean
   process/shutdown boundary.
2. **Repeated Piper CLI.** Operationally simple, but every request reloads the model,
   so it cannot supply the required persistent warm or retained-memory evidence.
3. **Piper HTTP server.** Persistent, but introduces a listener and HTTP dependency
   that are unnecessary for feasibility and enlarge the isolation surface.

## Components and data flow

- `piper-candidate/bmo_piper/manifest.py` verifies exact filenames, sizes, SHA-256 values,
  model/config identity, speaker mapping, sample rate, and license metadata before
  loading the model.
- `piper-candidate/bmo_piper/engine.py` loads the pinned CPU model and synthesizes only speaker
  ID `0` to a canonical request-local WAV path.
- `piper-candidate/bmo_piper/process.py` owns the persistent worker process, request
  timeouts, bounded JSON protocol, scoped termination, and child reaping.
- `piper-candidate/bmo_piper/audio.py` validates WAV/MP3 structure and calculates technical
  metrics. `piper-candidate/bmo_piper/ffmpeg.py` performs the fixed mono/24 kHz/96 kbps
  conversion with timeout and process-tree cleanup.
- `piper-candidate/bmo_piper/benchmark.py` runs cold processes, one loaded warm process, the
  canonical phrase matrix, 20-request stability, and machine-readable measurement.
- `piper-candidate/bmo_piper/host_monitor.py` runs on the host, watches production and safety
  thresholds, and terminates only the named candidate on a stop condition.

The primary path is:

```text
text -> persistent Piper Prudence -> raw WAV -> validated WAV
     -> FFmpeg -> validated mono 24 kHz 96 kbps MP3
```

## Isolation and safety

The image uses a digest-pinned Python 3.10 base, hash-locked wheels, pinned Debian
runtime packages, Tini group forwarding, a non-root UID, read-only root filesystem,
all capabilities dropped, `no-new-privileges`, no network, no public port, restart
policy `no`, bounded logs, CPU/thread/PID controls, and narrow read-only asset plus
writable output/temp mounts. The external monitor enforces the 1.25 GiB warning,
five-second 1.0 GiB controlled abort, 750 MiB emergency abort, production health,
restart/OOM, kernel OOM, and 20 GiB disk gates.

## Errors and shutdown

Manifest or speaker mismatches fail before model load. Empty/malformed input, path
escape, missing assets, bad hashes, malformed/zero WAV, FFmpeg failure, and timeouts
return sanitized machine-readable errors. The controller terminates whole process
groups, bounds TERM-to-KILL escalation, removes only request-local temporary files,
and leaves listening artifacts outside Git. SIGTERM tests cover startup, load,
synthesis, FFmpeg, and idle boundaries.

## Evidence and decision

The harness emits raw records and a summary containing cold/load/synthesis/FFmpeg/
total timing, CPU, real-time factor, cgroup memory, host reserve, process/descriptor/
temp trends, validation, and hashes. Identical text is sent to warm production
Kokoro and Piper. Audio metrics are rejection guardrails only; the operator alone
decides subjective voice quality. The final evidence selects one Prompt 5 direction
without deploying Piper or marking P8 verified.

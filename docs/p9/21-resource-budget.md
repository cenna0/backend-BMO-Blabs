# Single-VPS Resource Budget

**Status:** `P9.1 LOCKED INITIAL TARGETS; EXACT CAPS OPEN`

## Evidence baseline

P8 evidence describes the current host as approximately 8.3 GiB RAM with no
swap. The P8 production canary observed approximately 2.596–2.689 GiB host
`MemAvailable`; the retained P7 soak recorded a 3.209 GiB minimum. Piper's
current Audio Service is the dominant memory consumer and must not be
overlapped with replacement instances during rollout.

These are evidence baselines, not permission to increase concurrency.

## Initial budget proposal

| Consumer | Initial cap/operating rule | Gate |
|---|---|---|
| Audio Service + Piper | retain current verified limit and one warm worker | P8 regression and no OOM/restart |
| Backend | bounded container memory/CPU below remaining reserve | API/load test |
| Hermes host runtime | preserve current healthy host allocation | existing health/soak |
| PostgreSQL | one pinned-major private container; initial memory limit 768 MiB; connection cap target approximately 20 | DB restart/load/restore/capacity |
| Prisma pool | initial pool target 5 | connection exhaustion/load test |
| Scheduler worker | one active worker initially; bounded claim batch and concurrency | duplicate-run/DST/backlog test |
| Mobile/API requests | rate limits and bounded payloads; no unbounded provider fan-out | load test |
| Host reserve | preserve a measured emergency reserve before enabling optional features | capacity gate |

The initial targets above are LOCKED for P9.1 capacity testing. Exact final
container caps and PostgreSQL tuning remain OPEN until isolated resource tests
measure the live deployment.
The initial operating policy is single-VPS, low concurrency, no vector service,
no simultaneous TTS model loading, no unbounded scheduler backlog, and no
overlapping production canary instances for Audio Service.

## Capacity tests

- Measure idle, auth/chat, memory search, schedule worker, Spotify/WhatsApp
  adapter timeout, and voice-plus-application mixed load.
- Record CPU, RSS/cgroup memory, host `MemAvailable`, swap, disk, file
  descriptors, worker backlog, response latency, OOM events, and restarts.
- Test graceful degradation: disable optional integrations and candidate
  generation before core voice or auth becomes unhealthy.
- Treat any OOM, runaway backlog, or reserve breach as a failed gate, not a
  tuning suggestion.

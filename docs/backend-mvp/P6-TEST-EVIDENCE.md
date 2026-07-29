# P6 — VPS Foundation and Operations Baseline — Test Evidence

**Status:** `VERIFIED`
**Continued/verified:** 2026-07-28
**Telegram group target reverified:** 2026-07-29
**Authorized by:** explicit user instruction to continue P6 only from the current VPS state
**P6 notification implementation commit:** `d3103da`
**P6 evidence/status commit:** `d0ae312`
**P6 backup recovery commit:** `1be444f`
**P7 status:** `NOT_STARTED`

This report is sanitized. It does not contain active passwords, API keys, bot
tokens, Tailscale credentials, Beszel Agent credentials, Hermes credentials,
authorization headers, or private Git credentials.

## 1. Result

The VPS foundation is operational and all P6 acceptance gates pass. Both
Telegram paths returned strict delivery success and the operator confirmed
both labeled messages were received. The Hermes health timer is enabled and
healthy. P7 was not started.

## 2. Preflight and branch result

The earlier P6 preflight classified Hermes `ABSENT`. The P6 bootstrap branch
was selected. The 2026-07-28 re-audit confirms:

```text
OS                    Ubuntu 24.04.4 LTS
Kernel                6.8.0-124-generic
CPU / RAM             4 vCPU / 7.8 GiB
Root disk             95.82 GiB total / about 88 GiB available
Operator              bmo-admin (sudo + docker groups)
Production checkout   /opt/bmo/app
Git branch            main
Initial HEAD/origin    114dbd6fc3fbd23ad01a8d6f2470da5a2bca9f50
P6 implementation     d3103da (local main; not pushed in this execution)
Hermes branch         ABSENT -> bootstrapped host runtime
```

Before this evidence file was written, `git fetch origin main` passed,
`HEAD == origin/main`, and the working tree was clean. The remote URL contains
no embedded credential. P6 was then implemented and recorded in local commits
through `1be444f`; no remote push was performed. The final evidence update
restores a clean local working tree.

## 3. Hermes host runtime

```text
Version              0.19.0
Runtime user/group   hermes:hermes (UID/GID 1003)
Install path         /home/hermes/.hermes/hermes-agent
Config root          /home/hermes/.hermes
Primary config       /home/hermes/.hermes/config.yaml
Sensitive env        /home/hermes/.hermes/.env (mode 600; contents not captured)
Data/state           /home/hermes/.hermes/state,
                     /home/hermes/.hermes/state.db,
                     /home/hermes/.hermes/response_store.db,
                     /home/hermes/.hermes/sessions,
                     /home/hermes/.hermes/memories
Unit                 /etc/systemd/system/hermes-gateway.service
Startup              systemd, enabled, Restart=always
Listener             127.0.0.1:8642 only
Health               GET http://127.0.0.1:8642/health -> status=ok
```

Controlled restart proof:

```text
PID before restart   197288
PID after restart    235661
Health recovery      PASS on poll 4
Post-restart state   active/running, enabled
Listener             127.0.0.1:8642 only
```

Exact normal recovery commands:

```bash
sudo systemctl status hermes-gateway --no-pager
sudo systemctl start hermes-gateway
sudo systemctl stop hermes-gateway
sudo systemctl restart hermes-gateway
curl --fail --silent --show-error http://127.0.0.1:8642/health
ss -lntp | grep ':8642'
```

Do not reinstall, relocate, Dockerize, or change the `hermes` ownership model
as a first recovery action.

## 4. Operator, filesystem, Git, and secrets

- `bmo-admin` is the active Tailscale SSH operator.
- Codex works as `bmo-admin` (`codex-cli 0.145.0`).
- `bmo-admin` belongs to `sudo` and `docker`. Docker-group access is
  root-equivalent and was used for the root-level P6 workflow when noninteractive
  `sudo` was unavailable.
- `/opt/bmo/app` is the approved `main` checkout and fetch access works.
- `/opt/bmo/deploy/current`, `/opt/bmo/deploy/previous`, and
  `/opt/bmo/deploy/history` exist.
- Persistent data, config, backups, and models are outside the Git checkout.
- Beszel Agent key/token files are mode `600`.
- The Git checkout contains only `.env.*.example` templates, not live runtime
  `.env` files.

## 5. Docker, logging, and version pins

```text
Docker Engine         29.6.2
Docker Compose        5.3.1
Docker cgroup driver  systemd
Docker log driver     json-file
Log rotation          10m x 3 files
Docker live restore   enabled
```

Beszel is pinned by tag and digest in
`/opt/bmo/deploy/infra-compose.yml`:

```text
Hub    henrygd/beszel:0.18.7
       sha256:a849ad80814b6a1a3be665304dcace5d4854b3bed7bde4dd1227e8ce1b82d477
Agent  henrygd/beszel-agent:0.18.7
       sha256:8874e2c53f9de5e063a6a80d6b617e20fa593ac5dc4eb4c6ce1f912f510f38f8
Relay  python:3.12-alpine
       sha256:6d43704baacd1bfbe7c295d7f13079d5d8104ed33568873133f8fc69980419df
```

All three containers use `restart: unless-stopped` and bounded per-container
logging. Hub, Agent, and the private Telegram relay are `healthy`. The relay
has a read-only filesystem, all capabilities dropped, core limit zero, and no
published host port.

## 6. Beszel systemd telemetry diagnosis

Initial symptom:

```text
Host/container metrics visible
systemd_services records = 0
system D-Bus socket mounted read-only
systemd 255
Agent running as container root
```

Root-cause reproduction from a default Docker AppArmor container:

```text
Failed D-Bus Hello:
An AppArmor policy prevents this sender from sending this message
```

The pinned Beszel 0.18.7 Agent calls the system bus directly. It does not use
`/run/systemd/private` as a fallback in this path, so adding only the private
socket mount would not fix the reproduced failure. The upstream-documented
fix for the observed AppArmor error was applied only to the Agent:

```yaml
security_opt:
  - apparmor:unconfined
  - no-new-privileges:true
```

The Agent remains `privileged=false`; the D-Bus and Docker socket mounts remain
read-only. `/var/run/systemd/private` was deliberately not mounted.

Post-fix evidence:

```text
D-Bus ListUnits        PASS
D-Bus property read    PASS
systemd records        6
visible units          bmo-backup.timer
                       bmo-hermes-health-notify.timer
                       caddy
                       docker
                       hermes-gateway
                       tailscaled
```

## 7. DNS, Caddy, TLS, and firewall

```text
Caddy                  2.11.4
Runtime source         /etc/caddy/Caddyfile (root:caddy, mode 640)
Recoverable source     /opt/bmo/config/caddy/Caddyfile
Source checksums       identical
api HTTP               308 -> HTTPS
api HTTPS              valid certificate; deliberate P6 503 placeholder
monitor HTTP           308 -> HTTPS
monitor HTTPS          valid certificate; Beszel 200
Certificate issuer     Let's Encrypt
Certificate expiry     2026-10-26
```

The running Caddy process initially still held Ubuntu's default HTTP-only
file-server config even though the final file had been deployed. Reload and a
controlled service restart proved that the persistent final config activates
ports 80/443, redirects, both certificates, the API placeholder, and the
loopback Beszel proxy.

The active Codex SSH transport is a Tailscale address. A second Tailscale SSH
session was also visible before the firewall transition. The temporary public
SSH allow was then removed.

Final UFW surface:

```text
80/tcp                    public allow
443/tcp                   public allow
22/tcp on tailscale0      allow
public 22/tcp allow       absent
```

Internal listener evidence:

```text
127.0.0.1:8090   Beszel Hub
127.0.0.1:8642   Hermes
:3000            absent
:8000            absent
:8001            absent
:5432            absent
```

This is still P6: `api.personalbmo.web.id` is a placeholder and is not a
verified BMO API.

## 8. Monitoring and alerts

- Beszel Hub and Agent are healthy and connected.
- Hub publication is `127.0.0.1:8090` only.
- Anonymous collection requests return zero records.
- One authenticated admin/user exists; auto user creation, auto-login, and
  share-all-systems are disabled.
- Current stats include CPU, RAM, load, network, Host Root disk usage/I/O,
  Docker containers, and the six selected systemd units.
- Same-VPS monitoring cannot notify during total VPS/network loss.

Supported baseline alerts configured:

```text
System down    1 minute
CPU > 90%      10 minutes
RAM > 80%      5 minutes
Any disk >79%  1 minute (about 20 GiB free on the current 95.82 GiB root disk)
```

Beszel 0.18.7 permits only one alert per metric, so separate 80% warning and
90% critical RAM rules cannot coexist. This release also has no swap alert and
no per-systemd-service alert. The host currently has no swap configured.
Telegram and Hermes notification result:

```text
Credential directory metadata      root:root 0700
Token/chat file metadata           root:root 0600 regular single-line files
Beszel managed relay webhooks      1
Native Telegram webhooks           0
Credential-bearing webhooks        0
Private relay                      healthy; no published port
Direct strict test                 HTTP 2xx + Telegram ok=true PASS
Beszel relay test                  HTTP 2xx + Telegram ok=true PASS
Operator confirmed both receipts   PASS
Hermes failure threshold           3 consecutive failures
Repeated down notification         suppressed
Recovery notification              exactly one
Timer                              enabled / active
Healthy state                      failures=0, down_alerted=false
```

The pinned Shoutrrr 0.14.1 Telegram client can falsely report success for a
failed request, so Beszel stores only a token-free generic webhook to the
private `bmo-telegram-relay` container. The relay reuses the strict sender and
returns success to Beszel only after Telegram returns HTTP 2xx and decoded
boolean `ok=true`.

The direct sender, relay, Beszel configuration helper, three-failure state
machine, and recovery behavior passed 35 isolated tests. Both
credential-consuming systemd services set `LimitCORE=0`; their
`systemd-analyze security` exposure score is `3.1 OK`.

Post-test scans found zero active token/chat values in process arguments,
process environments, systemd/relay/Beszel logs, shell history, or repository
files. Values were never printed or written into evidence.

## 9. Backup and restore

```text
Script               /usr/local/sbin/bmo-backup
Service              bmo-backup.service
Timer                bmo-backup.timer
Schedule             Sunday 03:15 + randomized delay, persistent
Retention deletion   disabled pending separate destructive approval
```

Final verified protected artifact:

```text
Timestamp                 20260728T100838Z
runtime-config checksum   PASS
Beszel recovery checksum  PASS
Git branch/clean marker   main / clean at 1be444f
Release pointer dirs      included
Beszel data.db            included
Telegram credential files included with protected archive metadata
Notification executables  included
Notification units        included
Backup script             included
```

An isolated restore of `etc/caddy/Caddyfile` from artifact
`20260728T073248Z` succeeded and matched the live recoverable Caddy source.
No live file was overwritten.

PostgreSQL backup remains intentionally inactive until P9.

## 10. Restart/reboot result

Controlled restart tests passed for:

- Hermes systemd service;
- Caddy systemd service;
- Beszel Hub + Agent Compose stack;
- private Telegram relay activation and Beszel Agent recreation.

Docker, Caddy, Tailscale, Hermes, UFW, the backup timer, the Hermes health
timer, and Compose restart policies are enabled for startup as applicable. A
full VPS reboot was deferred because it would terminate the active
Codex/Tailscale execution context. This deferral is not represented as reboot
proof.

The host currently reports `systemd` state `degraded` because of two
pre-existing boot failures:

```text
cloud-init.service
systemd-networkd-wait-online.service
```

Current networking and all P6 services are operational. The old failures were
not cosmetically cleared or altered during P6 and remain a maintenance risk to
review before a future planned reboot.

## 11. Fresh audit summary

```text
PASS operator + Codex
PASS Git main/fetch/clean before evidence edit
PASS Hermes health/startup/loopback-only listener
PASS Docker/Compose/Beszel health
PASS /opt/bmo layout and secret permissions
PASS DNS/Caddy/TLS/routes
PASS Tailscale SSH
PASS UFW approved surface; public SSH allow removed
PASS no public internal origins and no P7 listeners
PASS host/container/systemd metrics
PASS authenticated monitor with anonymous data denied
PASS supported baseline alerts
PASS strict dual Telegram path and operator receipt
PASS Hermes three-failure/single-recovery timer enabled and healthy
PASS bounded Docker logging
PASS backup timer, protected artifact, checksum, and restore exercise
PASS disk headroom
PASS documentation verifier including this evidence file
WARN full VPS reboot deferred
WARN pre-existing cloud-init/wait-online failed state
WARN Beszel 0.18.7 alert-model limitations
```

### 11.1 Telegram group target migration

On 2026-07-29, the operator explicitly authorized moving both P6 Telegram
notification paths from the prior private chat to the `monitorvpsBMO` group.
The numeric chat identifier remains omitted from this sanitized evidence.

```text
Telegram getChat HTTP/API validation        PASS
Telegram chat type                          group
Telegram chat title                         monitorvpsBMO
Chat-ID replacement                         atomic same-directory rename
Credential directory metadata               root:root 0700
Token/chat file metadata                    root:root 0600 regular single-line
Beszel settings update                      authenticated API PATCH
Direct database settings edit               none
Beszel managed internal relay targets       1
Relay strict delivery                       HTTP 2xx + Telegram ok=true PASS
Hermes strict delivery                      HTTP 2xx + Telegram ok=true PASS
[BMO BESZEL GROUP TEST] receipt              operator confirmed
[P6 HERMES GROUP TEST] receipt               operator confirmed
Hermes timer/state                          enabled / active; clean
P7                                          NOT_STARTED
Git push                                    not performed
```

The relay rewrites only the byte-for-byte Beszel 0.18.7 built-in test payload
to `[BMO BESZEL GROUP TEST]`. Seven near-match and ordinary payload cases prove
that whitespace, punctuation, case, prefix, substring, and normal alert
variations retain the existing `[BMO BESZEL]` label. The current notification
suite passes 38 tests.

The deployed notifier and relay match the verified repository sources.
Systemd unit files and effective sandbox controls remain unchanged. The relay
remains healthy, read-only, capability-free, non-privileged, without a
published port, and with both credentials mounted read-only. Post-change scans
found no active bot token or complete Shoutrrr target in notification logs,
shell histories, or current process arguments.

## 12. Stop condition

P6 is `VERIFIED`. P7 is the next dependency phase but remains `NOT_STARTED`.
Do not begin P7 without a separate explicit user authorization and execution
turn.

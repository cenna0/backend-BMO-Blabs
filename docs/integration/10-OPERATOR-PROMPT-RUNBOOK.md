# Operator Runbook After Documentation Freeze

**Use after:** the Phase 1 branch/commit is reviewed and Phase 2 is explicitly authorized.

## 1. Start a clean implementation session

Provide the Phase 1 final commit SHA and ask the agent to use `07-ONE-SHOT-AGENT-PROMPT.md`. The first response must confirm:

- the checked-out source includes the freeze commit;
- production source/runtime has not drifted;
- no secrets were printed;
- Prisma Studio `*:5555` is closed or the session is stopped for missing runtime authority;
- no production migration/deployment will occur without its explicit gate.

## 2. Manual gates

Only the operator may supply or authorize:

- production maintenance/deployment window;
- privileged firewall/runtime changes when not already authorized;
- production backup and migration execution;
- Spotify application credentials/callback registration;
- WhatsApp session/provider credentials;
- physical ESP firmware/bench access.

Send secrets out-of-band. Never paste them into chat, Git, logs, or documentation.

## 3. Resume prompt after a proven gate

```text
Gate yang dicatat sudah diselesaikan. Verifikasi bukti tanpa menampilkan secret, lanjutkan dari slice/checkpoint yang sama di docs/integration/04-VPS-IMPLEMENTATION-PLAN.md, dan jangan ulangi langkah yang sudah PASS. Update status serta coverage matrix bersama perubahan implementasinya. Jangan deploy atau menjalankan migration production kecuali gate tersebut memang yang baru saya otorisasi.
```

## 4. Independent completion audit

Use a fresh session after the implementation branch is pushed:

```text
Audit implementasi terhadap commit freeze Phase 1 dan seluruh docs/integration/00-10. Enumerasi route terdaftar, schema/migration, device /ws, mobile /api/v1/ws, source-of-truth, Caddy/public-private exposure, tests, dan Git diff. Verifikasi raw-WAV/MP3/device WSS tidak regress. Jangan promosikan PENDING_PHYSICAL_ESP tanpa real-device evidence. Fix drift yang aman dalam scope, update status/matrix, lalu commit/push. Laporkan blocker eksternal secara exact.
```

## 5. Stop rules

Stop and return evidence when authority is missing for a destructive/runtime action, a production migration/deploy, provider secrets, or physical firmware. A backend implementation may continue around an external provider or physical blocker only if its tests are isolated and its status remains honest.

Phase 1 itself ends at the documentation commit. It must not flow automatically into this runbook.

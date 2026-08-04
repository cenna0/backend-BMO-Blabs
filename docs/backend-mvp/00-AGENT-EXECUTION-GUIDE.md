# BMO Backend MVP — Agent Execution Guide

**Backend reference lineage:** 1.0.1 (historical split-package lineage)  
**Current docs audit:** 2026-08-04
**Status dokumentasi:** CURRENT / AUDITED  
**Active implementation phase:** lihat `IMPLEMENTATION-STATUS.md` — jangan gunakan status statis dari snapshot package lama

> **Status:** Canonical backend MVP documentation package  
> **Derived from:** Backend Implementation v1.0.5, Hardware Contract v1.0.5, PRD v1.2.4  
> **Scope:** Active backend references in this folder primarily define the voice MVP. Firmware, mobile app, Spotify, WhatsApp, and the future application database are not silently pulled into a voice phase. P9 may implement PostgreSQL/Prisma only under its own authorized execution spec, while voice request state remains in-memory.


## 0. Current next action

For the current project state, P8 is `P8_PIPER_PRODUCTION_VERIFIED` and the
next implementation phase is **P9 — Final Application-Platform Architecture**.
P9 implementation is not started or authorized by this documentation branch.
Before using the general workflow in this file, read:

1. `../NEXT-ACTION.md`
2. `../p9/README.md`
3. `IMPLEMENTATION-STATUS.md`
4. `../operations/MAINTENANCE-AND-RECOVERY.md` for P6+ host operation/recovery rules

P8 production closure is recorded in `P8-PRODUCTION-ROLLOUT-EVIDENCE.md`.
P9 architecture is ready for review, but no PostgreSQL, Prisma, auth, mobile,
memory, scheduler, Spotify, WhatsApp, or proactive-audio implementation is
authorized by this branch. A future implementation prompt must explicitly
authorize a single P9 subphase and stop at its acceptance gate.

## 1. Tujuan file ini

File ini adalah entry point wajib bagi coding agent. Agent tidak boleh mulai membuat atau mengubah source code sebelum membaca file ini, `IMPLEMENTATION-STATUS.md`, seluruh dokumen canonical yang diwajibkan untuk phase aktif, dan kontrak hardware yang relevan.

Package ini memisahkan spesifikasi backend menjadi beberapa file agar agent:

- tetap berada di scope backend voice MVP;
- tidak mengubah keputusan yang sudah dikunci;
- tidak mengerjakan phase yang belum diotorisasi;
- melakukan implementasi dan verifikasi secara bertahap;
- tidak berhenti hanya karena project berhasil build;
- mencatat bukti test sebelum menyatakan pekerjaan selesai.

## 2. Urutan baca wajib

Agent wajib membaca dalam urutan berikut:

1. `00-AGENT-EXECUTION-GUIDE.md`.
2. `IMPLEMENTATION-STATUS.md`.
3. `01-SCOPE-AND-DECISIONS.md`.
4. `../operations/MAINTENANCE-AND-RECOVERY.md` untuk phase P6+ yang menyentuh VPS/operations.
5. `../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md` hanya untuk kewajiban public interface backend.
6. Dokumen implementation package yang diwajibkan oleh phase aktif.
7. `05-TESTING-AND-ACCEPTANCE.md` untuk test dan definition of done phase aktif.
8. `REQUIREMENT-TRACEABILITY.md` saat verifikasi akhir.
9. Bagian PRD relevan di `../product/BMO-BY-BLABS-PRD-v1.2.4.md` hanya untuk consistency check; PRD bukan instruksi untuk mengimplementasikan fitur phase lain.

Agent boleh membaca dokumen lain untuk memahami dependency dan interface, tetapi **tidak boleh mengimplementasikan scope dokumen lain** kecuali status phase-nya `AUTHORIZED` atau `IN_PROGRESS`.

## 3. Hierarchy source of truth

Jika ditemukan perbedaan, gunakan urutan authority berikut:

1. **Public firmware ↔ backend interface:** `../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`.
2. **Current STT/TTS runtime values:** `CURRENT-RUNTIME-CONFIG.md`.
3. **Actual implementation status/evidence:** `IMPLEMENTATION-STATUS.md` + latest phase/manual evidence.
4. **Detail implementasi backend/audio service:** active canonical references di folder `backend-mvp/` ini.
5. **Deployment-specific public values:** `../hardware-handoff/DEPLOYMENT-CONFIG.md` hanya setelah statusnya `VERIFIED`.
6. **Konteks produk/arsitektur:** PRD v1.2.4.
7. **Dokumen backend lama/audit intermediate:** `../archive/`; historical only.

Agent dilarang menyelesaikan konflik dengan mengubah kontrak sendiri. Konflik harus dicatat sebagai `BLOCKED` dan dilaporkan kepada user.

## 4. Scope yang boleh dikerjakan

Hanya bila phase terkait telah diotorisasi, agent boleh:

- membuat Express.js + TypeScript backend;
- membuat WebSocket server, REST routes, state store, dan voice pipeline orchestration;
- membuat Local Audio Service dengan Python + FastAPI;
- mengintegrasikan faster-whisper, Kokoro, RVC, dan FFmpeg;
- membuat adapter ke P6-verified Hermes host API;
- membuat fake ESP32, test fixtures, automated tests, dan benchmark;
- membuat Dockerfile, Docker Compose, health check, cleanup, dan staging backend;
- membuat mock, stub, interface, atau feature flag minimal untuk dependency phase berikutnya.

## 5. Scope yang dilarang

Agent dilarang:

- membuat atau mengubah firmware ESP32;
- mengubah hardware wiring, wake word implementation, display implementation, atau decoder firmware;
- membangun mobile app;
- mengimplementasikan Spotify atau WhatsApp;
- mengimplementasikan PostgreSQL/Prisma before P9 authorization or moving voice-request state into PostgreSQL; P9 is a separate application-data phase governed by the roadmap/latest approved data requirements;
- mengubah PRD, hardware contract, keputusan locked, endpoint, event, field JSON, close code, atau error code tanpa approval user;
- mengubah global Hermes config atau `SOUL.md`;
- memindahkan, mengganti, atau mengekspos instalasi Hermes yang terbukti ada; recover melalui mechanism existing dan jangan reinstall/migrate untuk cosmetics;
- melakukan tindakan infrastructure berisiko di luar scope phase yang sudah diotorisasi. Untuk **P6**, satu instruksi eksplisit user untuk `execute P6`/`continue next phase` sudah mengotorisasi instalasi/config non-destruktif yang memang tercantum di `../roadmap/P6-EXECUTION-SPEC.md` (Docker/Compose, Caddy, Tailscale, Beszel, TLS, transisi firewall yang aman, dan conditional Hermes path). If Hermes is absent berdasarkan preflight evidence, P6 mengotorisasi initial host-runtime bootstrap. Approval tambahan tetap wajib untuk penghapusan data/container/image/volume, migrasi instalasi Hermes yang terbukti ada, menutup satu-satunya SSH path sebelum alternatif terbukti, rotasi credential existing, atau perubahan destruktif/tidak terduga;
- mengerjakan phase `NOT_STARTED` atau `BLOCKED`; phase `READY` hanya boleh dimulai setelah explicit user execution command mengubahnya menjadi `AUTHORIZED/IN_PROGRESS`;
- melakukan refactor spekulatif atau membuat fitur future hanya karena terlihat mudah.

## 6. Aturan phase dan status

Status implementation yang valid:

```text
NOT_STARTED
READY
AUTHORIZED
IN_PROGRESS
BLOCKED
IMPLEMENTED
VERIFIED
```

Makna:

- `READY`: requirement cukup, tetapi coding belum diizinkan.
- `AUTHORIZED`: user telah mengizinkan phase tersebut dikerjakan.
- `IN_PROGRESS`: agent sedang mengerjakan phase tersebut.
- `IMPLEMENTED`: code selesai dibuat, tetapi bukti verifikasi belum lengkap.
- `VERIFIED`: seluruh acceptance criteria phase telah lulus dengan evidence.
- `BLOCKED`: terdapat hambatan nyata yang tidak boleh diatasi dengan mengubah spesifikasi.

Agent hanya boleh mengubah status sesuai transisi berikut:

```text
READY → AUTHORIZED → IN_PROGRESS → IMPLEMENTED → VERIFIED
                         └──────────────→ BLOCKED
```

Agent **tidak boleh mengotorisasi dirinya sendiri**. Perubahan `READY` menjadi `AUTHORIZED` hanya boleh dilakukan setelah instruksi eksplisit user.

## 7. Batas file yang boleh disentuh

Pada phase aktif, agent hanya boleh mengubah:

- source code dan test yang termasuk authorized scope;
- evidence/report untuk phase aktif;
- `IMPLEMENTATION-STATUS.md` pada bagian status dan evidence phase aktif;
- `CHANGELOG.md` untuk mencatat perubahan implementasi yang benar-benar terjadi.

File berikut read-only kecuali user secara eksplisit meminta revisi dokumentasi:

- `00-AGENT-EXECUTION-GUIDE.md`;
- `01-SCOPE-AND-DECISIONS.md`;
- `02-API-AND-WEBSOCKET-CONTRACT.md`;
- `03-BACKEND-ARCHITECTURE.md`;
- `04-AUDIO-SERVICE.md`;
- `05-TESTING-AND-ACCEPTANCE.md`;
- `06-DEPLOYMENT-AND-OPERATIONS.md`;
- hardware contract;
- PRD;
- requirement traceability.

Nama file dokumentasi bersifat permanen dan **tidak boleh diubah berdasarkan status**. Status pekerjaan hanya dicatat di `IMPLEMENTATION-STATUS.md`.

## 8. Placeholder dependency

Jika phase aktif membutuhkan dependency dari phase berikutnya, agent hanya boleh membuat:

- type/interface;
- mock/stub eksplisit;
- test fixture;
- feature flag yang default-nya aman;
- adapter boundary tanpa implementasi future.

Placeholder harus diberi nama dan komentar yang jelas, dites, dan tidak boleh diam-diam menjalankan implementasi phase berikutnya.

## 9. Workflow local-first

Source code utama dibuat dan dipelihara di local repository/Git.

```text
implementasi lokal
→ unit/integration test lokal yang memungkinkan
→ commit/push
→ deploy ke VPS untuk Hermes/model/network integration
→ benchmark dan integration test VPS
→ perbaikan kembali ke source repository
→ redeploy
```

Git `main` is the production source of truth. `/opt/bmo/app` is a clean production/deployment checkout, not a scratch development directory. If Codex must change application code, use a normal Git branch/worktree or separate development checkout, run the required tests, merge/land the approved change into `main`, then update `/opt/bmo/app` to the selected commit and rebuild immutable images. An emergency host edit is not a valid production release until it is captured in Git and redeployed, otherwise drift exists.

Secret asli, model weights, cache model, dan generated audio tidak boleh disimpan di Git.

## 10. Verification loop wajib

Untuk setiap phase aktif, agent wajib melakukan loop berikut:

```text
map requirement
→ implement
→ run test
→ compare dengan dokumen phase
→ compare public interface dengan hardware contract
→ compare keputusan besar dengan bagian PRD relevan
→ inspect perubahan di luar scope
→ fix mismatch
→ ulangi test dan comparison
```

Loop berakhir hanya jika seluruh stop condition terpenuhi. Agent tidak boleh berhenti pada kondisi “build berhasil”, “service start”, atau “happy path bekerja”.

## 11. Stop condition phase

Phase baru boleh diberi status `VERIFIED` jika:

- seluruh requirement phase dipetakan ke file/function/test;
- seluruh test wajib phase lulus;
- tidak ada test wajib yang di-skip tanpa alasan dan approval;
- endpoint, event, header, response, close code, state, retry, dan error mapping sesuai kontrak;
- tidak ada perubahan di luar authorized scope;
- tidak ada keputusan locked yang berubah;
- hasil sesuai dokumen backend dan bagian PRD relevan;
- security dan cleanup requirement phase terpenuhi;
- command dan output evidence dicatat;
- known limitation dan hal yang belum diverifikasi dinyatakan jujur;
- `IMPLEMENTATION-STATUS.md` diperbarui dengan commit dan evidence.

## 12. Kondisi BLOCKED

Gunakan `BLOCKED` jika, misalnya:

- disk VPS di bawah batas aman untuk model/dependency;
- Hermes API berubah atau tidak kompatibel;
- dependency/model/license tidak dapat diverifikasi;
- tindakan membutuhkan approval user;
- test hardware diperlukan untuk membuktikan baseline;
- source documents memiliki konflik yang tidak dapat diselesaikan melalui hierarchy.

Saat blocked, agent harus mencatat:

```text
blocker
impact
bukti command/test
requirement yang terdampak
action/approval yang dibutuhkan
```

Agent dilarang mengarang keberhasilan, menurunkan acceptance criteria, atau mengubah kontrak untuk melewati blocker.

## 13. Aturan evidence

Setiap klaim keberhasilan harus memiliki bukti seperti:

- command yang dijalankan;
- exit code;
- ringkasan output test;
- health response yang sudah disanitasi;
- fixture atau sample output;
- benchmark latency/resource;
- commit hash;
- daftar file berubah.

Jangan mencatat secret, raw authorization header, device token, Hermes key, atau transcript/audio sensitif.

## 14. Historical package bootstrap state

Documentation package telah diverifikasi. Tidak ada phase coding yang otomatis aktif.

```text
Documentation package bootstrap (2026-07-18): VERIFIED
Initial next phase at that time: P1
```

This block is historical. P1–P5 have since progressed. **Current phase/status authority is `IMPLEMENTATION-STATUS.md` and the P6–P10 roadmap.** Agent authorization rules above remain active: a future phase still requires explicit user authorization before execution.

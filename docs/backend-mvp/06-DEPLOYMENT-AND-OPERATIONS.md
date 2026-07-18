# BMO Backend MVP — Deployment and Operations

**Versi:** 1.0.1  
**Status:** CANONICAL DEPLOYMENT REFERENCE

> **Status:** Canonical backend MVP documentation package  
> **Derived from:** Backend Implementation v1.0.5, Hardware Contract v1.0.5, PRD v1.2.0  
> **Scope:** Backend voice MVP only. Firmware, mobile app, Spotify, WhatsApp, PostgreSQL, dan Prisma tidak diimplementasikan dalam package ini.


## Cara menggunakan file ini

File ini mengatur deployment topology, filesystem, preflight, Docker Compose, environment variables, hardware test mode, staging, execution order, dan approval untuk tindakan berisiko.

Source code tetap dibuat local-first. Instruksi VPS dipakai untuk integration, benchmark, staging, dan production deployment—bukan sebagai pengganti repository Git.

## Interpretasi urutan kerja local-first

Backend source boleh mulai dibuat dan dites secara lokal setelah phase diotorisasi. `Preflight Audit` pada dokumen sumber wajib dilakukan **sebelum tindakan pertama pada VPS**, bukan sebagai syarat untuk membuat source code lokal.

Urutan efektif package ini:

```text
Dokumentasi VERIFIED
→ user mengotorisasi phase
→ implementasi/test lokal
→ commit source
→ preflight VPS sebelum tindakan VPS pertama
→ deploy/integration/benchmark VPS
→ perbaikan kembali ke source repository
```

Urutan pada Source §32 tetap wajib untuk pekerjaan yang dijalankan oleh agent di VPS. Interpretasi ini tidak mengubah arsitektur deployment atau acceptance criteria; hanya mencegah VPS menjadi source code utama.

## 4. Arsitektur Deployment

VPS sudah memiliki Docker.

```text
VPS host
├── Hermes Agent
│   └── 127.0.0.1:8642
│
└── Docker Compose
    ├── bmo-backend
    │   ├── network_mode: host
    │   └── 0.0.0.0:3000
    └── bmo-audio-service
        ├── bridge network biasa
        └── publish 127.0.0.1:8001 → container:8001
```

Gunakan `network_mode: host` **hanya untuk backend**, karena backend harus mengakses Hermes pada `127.0.0.1:8642` milik host. Audio service tidak membutuhkan host networking dan harus diisolasi pada bridge network dengan port yang hanya dipublish ke loopback host.

```yaml
bmo-backend:
  network_mode: host
  restart: unless-stopped

bmo-audio-service:
  ports:
    - "127.0.0.1:8001:8001"
  restart: unless-stopped
```

- Backend memanggil Audio Service melalui `http://127.0.0.1:8001`.
- Audio service tidak boleh menerima secret Hermes atau device token.
- Backend boleh bind ke `0.0.0.0:3000` untuk staging setelah aman.
- Setelah domain tersedia, gunakan reverse proxy dan TLS.

---

## 5. Struktur Filesystem

Gunakan:

```text
/opt/bmo-mvp/
├── backend/
├── audio-service/
├── tests/
├── scripts/
├── models/
│   ├── hf-cache/
│   ├── torch-cache/
│   └── rvc-bmo/
├── temp-audio/
├── docker-compose.yml
├── .env.backend
├── .env.audio
├── .env.backend.example
├── .env.audio.example
├── MODEL_MANIFEST.md
└── README.md
```

Aturan:

- Permission `.env.backend` dan `.env.audio`: `600`.
- Gunakan file environment terpisah agar Audio Service tidak menerima `HERMES_API_KEY`, `DEVICE_TOKEN`, atau secret backend lain.
- Jangan commit `.env`, model weights, generated audio, atau credentials.
- `temp-audio/` harus writable oleh backend container.
- Catat source, revision/commit, nama file, ukuran, dan SHA256 semua model di `MODEL_MANIFEST.md`.

---

## 6. Preflight Audit

Sebelum memasang apa pun, kumpulkan:

```bash
uname -a
cat /etc/os-release
nproc
free -h
df -h
docker --version
docker compose version
ss -lntp
```

Periksa juga:

- sisa disk;
- container/image/volume Docker existing;
- proses yang memakai port `3000`, `8001`, dan `8642`;
- kesehatan Hermes;
- load CPU dan RAM;
- jumlah proses FFmpeg existing.

Aturan keselamatan:

- Jangan hapus container, image, volume, cache, atau data user tanpa membuat daftar dan meminta persetujuan.
- Jangan menghapus atau memodifikasi `/home/rangga/.hermes`, virtual environment Hermes, atau executable Hermes.
- Jika free disk di bawah **20 GB**, hentikan download model/PyTorch/RVC dan laporkan blocker.
- Setelah user mengosongkan server, audit ulang sebelum instalasi.

---

## 25. Docker Compose

Minimal:

```yaml
services:
  bmo-backend:
    build: ./backend
    network_mode: host
    restart: unless-stopped
    env_file: .env.backend
    volumes:
      - ./temp-audio:/opt/bmo-mvp/temp-audio
      - ./tests/fixtures:/opt/bmo-mvp/tests/fixtures:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

  bmo-audio-service:
    build: ./audio-service
    restart: unless-stopped
    env_file: .env.audio
    ports:
      - "127.0.0.1:8001:8001"
    environment:
      HF_HOME: /opt/bmo-mvp/models/hf-cache
      TORCH_HOME: /opt/bmo-mvp/models/torch-cache
      XDG_CACHE_HOME: /tmp/cache
    volumes:
      - ./models:/opt/bmo-mvp/models:ro
    read_only: true
    tmpfs:
      - /tmp:size=1g
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 300s
```

Kedua image harus menjalankan process sebagai user non-root. Tambahkan log rotation pada masing-masing service:

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

Pastikan image menyediakan `curl` jika dipakai di healthcheck. Jika RVC membutuhkan writable cache tambahan, mount hanya directory cache khusus—jangan membuat seluruh root filesystem writable.

---

## 26. Environment Variables

`.env.backend.example`:

```env
NODE_ENV=production
BACKEND_HOST=0.0.0.0
BACKEND_PORT=3000
PUBLIC_BASE_URL=http://<IP_VPS>:3000

DEVICE_ID=bmo-001
DEVICE_TOKEN=replace-with-random-staging-secret

HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=replace-me
HERMES_MODEL=hermes-agent
HERMES_CONVERSATION=bmo-001
HERMES_SOFT_TIMEOUT_MS=30000
HERMES_HARD_TIMEOUT_MS=180000

AUDIO_SERVICE_URL=http://127.0.0.1:8001
INTERNAL_SERVICE_TOKEN=replace-with-random-secret

TEMP_AUDIO_DIR=/opt/bmo-mvp/temp-audio
TEMP_AUDIO_TTL_SECONDS=300
TEMP_AUDIO_CLEANUP_INTERVAL_SECONDS=30
REQUEST_TOMBSTONE_TTL_SECONDS=600
MAX_REQUEST_STORE_ENTRIES=1000
MAX_AUDIO_BYTES=3145728
MAX_AUDIO_DURATION_SECONDS=60
TOTAL_PIPELINE_TIMEOUT_MS=300000

HARDWARE_TEST_MODE=false
HARDWARE_TEST_MP3_PATH=/opt/bmo-mvp/tests/fixtures/test-response.mp3
```

`.env.audio.example`:

> Nilai `INTERNAL_SERVICE_TOKEN` di `.env.backend` dan `.env.audio` harus **identik**, tetapi secret lain tidak boleh disalin ke Audio Service.

```env
AUDIO_SERVICE_HOST=0.0.0.0
AUDIO_SERVICE_PORT=8001
INTERNAL_SERVICE_TOKEN=replace-with-random-secret

HF_HOME=/opt/bmo-mvp/models/hf-cache
TORCH_HOME=/opt/bmo-mvp/models/torch-cache
XDG_CACHE_HOME=/tmp/cache
MODEL_DOWNLOAD_ALLOWED=false

WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_CPU_THREADS=4
WHISPER_WORKERS=1
WHISPER_BEAM_SIZE=5
WHISPER_VAD=true

KOKORO_LANG_CODE=a
KOKORO_VOICE=af_heart

RVC_ENABLED=true
RVC_MODEL_PATH=/opt/bmo-mvp/models/rvc-bmo/model.pth
RVC_INDEX_PATH=
RVC_F0_UP_KEY=0
RVC_F0_METHOD=rmvpe

OUTPUT_MP3_SAMPLE_RATE=24000
OUTPUT_MP3_BITRATE=96k
```

Jangan menebak nama file `.pth`/`.index`; update env setelah inspeksi archive sebenarnya. `RVC_INDEX_PATH` boleh kosong jika archive tidak memiliki index yang kompatibel.

---

## 28. Mode Early Test untuk Tim Hardware

Tim hardware sudah memiliki ESP32 dengan wake word dan membutuhkan backend secepatnya.

Sediakan test mode yang dapat diaktifkan melalui env:

```env
HARDWARE_TEST_MODE=true
HARDWARE_TEST_MP3_PATH=/opt/bmo-mvp/tests/fixtures/test-response.mp3
```

Saat aktif:

```text
ESP32 upload WAV valid
→ backend tidak menjalankan STT/Hermes/TTS
→ backend langsung copy/serve MP3 dummy
→ backend kirim audio_ready
```

Tujuan:

- tim hardware bisa menguji WebSocket;
- upload WAV;
- event thinking;
- audio URL;
- download progressive;
- MP3 decoder;
- speaking/idle state;
- playback_done/failed.

Test mode harus disabled by default dan tidak boleh aktif bersamaan dengan production mode.

---

## 29. Tahapan Deployment

### Stage 1 — Verifikasi lokal VPS

- backend bind lokal sementara;
- audio service lokal;
- Hermes localhost;
- test menggunakan curl dan fake ESP32.

### Stage 2 — Staging melalui IP VPS

```text
HTTP upload : http://<IP_VPS>:3000/api/v1/voice
WebSocket   : ws://<IP_VPS>:3000/ws
Audio       : http://<IP_VPS>:3000/audio/<uuid>.mp3
```

Aturan:

- gunakan staging token;
- firewall hanya membuka port yang diperlukan;
- jangan expose 8001 atau 8642;
- dokumentasikan risiko HTTP plaintext;
- rotasi token setelah TLS aktif.

### Stage 3 — Domain + TLS

Setelah domain tersedia:

```text
HTTPS : https://api.<domain>/api/v1/voice
WSS   : wss://api.<domain>/ws
Audio : https://api.<domain>/audio/<uuid>.mp3
```

Gunakan Caddy atau Nginx:

- terminate TLS;
- proxy WebSocket upgrade;
- proxy HTTP upload dan audio;
- hanya expose 80/443;
- redirect HTTP ke HTTPS;
- pertahankan timeout upload yang sesuai.

---

## 32. Urutan Eksekusi

Hermes wajib menjalankan tahap secara berurutan:

```text
1. Preflight audit
2. Laporkan blocker/risk
3. Buat filesystem + secret template
4. Build backend skeleton + hardware test mode
5. Test WebSocket + raw WAV + dummy MP3
6. Berikan endpoint awal ke tim hardware
7. Build audio service dan model bootstrap script
8. Download/pin cache faster-whisper dan test
9. Download/pin cache Kokoro dan test
10. Download/inspect/test RVC model
11. Restart audio service untuk memastikan model tidak di-download ulang
12. Integrasi FFmpeg
13. Integrasi Hermes API
14. Integrasi full pipeline
15. Unit + integration + fake ESP32 tests
16. Resource benchmark
17. Staging deployment
18. Final report
```

Prioritaskan kontrak hardware lebih dulu agar tim HW tidak menunggu seluruh AI stack selesai.

---

## 33. Hal yang Harus Ditanyakan Sebelum Tindakan Berisiko

Minta approval user sebelum:

- menghapus data/container/image/volume;
- mengubah firewall;
- membuka port publik;
- mengubah global Hermes config atau `SOUL.md`;
- mengganti service existing;
- menginstal package langsung ke host di luar Docker;
- menggunakan model/license yang belum jelas;
- men-deploy domain/TLS;
- merotasi secret production.

Untuk tindakan aman di dalam `/opt/bmo-mvp/`, lanjutkan tanpa menunggu approval tambahan selama tidak merusak service existing.

---

# Joy Backend — Deployment and Operations Runbook

**Version:** 3.1.0  
**Status:** CANONICAL PRODUCTION OPERATIONS GUIDE  

Dokumen ini menyediakan panduan operasional lengkap untuk deployment, pemeliharaan, inspeksi, dan troubleshooting Joy Backend di server VPS production (`100.107.88.120`).

---

## 1. Arsitektur Deployment VPS

Sistem dideploy menggunakan Docker Compose dengan topologi jaringan terisolasi:

```text
Host Network (127.0.0.1)
├── Caddy Web Server (Port 80/443 Public)
│   └── Reverse proxy ke 127.0.0.1:3000 (api.personalbmo.web.id)
├── Joy Backend Gateway (Container: joy-production-p9-backend-1, Port 3000)
├── Joy Audio Service (Container: joy-production-audio-1, Port 8001)
├── PostgreSQL 16 (Container: joy-production-p9-postgres-1, Port 5432)
├── Hermes LLM Service (Host Service, Port 8642)
└── Beszel Monitoring Agent & Hub (Port 8090)
```

---

## 2. Struktur File Konfigurasi & Secret

Seluruh secret disimpan di luar git pada direktori `/opt/joy/config/`:

| File Path | Deskripsi | Izin Akses |
|---|---|---|
| `/opt/joy/config/backend.env` | Konfigurasi Gateway, Database URL, Groq API, JWT Secret | `chmod 600` |
| `/opt/joy/config/audio.env` | Konfigurasi Audio Service, Groq STT, Edge-TTS & Piper | `chmod 600` |
| `/opt/joy/app/ops/deploy/p9.1-production-compose.yml` | Compose P9 Backend + PostgreSQL production | `chmod 644` |
| `/opt/joy/app/docker-compose.yml` | Compose Audio Service production | `chmod 644` |

---

## 3. Perintah Operasional Harian

### 3.1 Menjalankan & Menghentikan Service

P9 Backend + PostgreSQL memakai compose file terpisah dari Audio Service:

```bash
cd /opt/joy/app

# Backend + PostgreSQL
docker compose --env-file /opt/joy/config/p9.1/compose.env -f ops/deploy/p9.1-production-compose.yml --project-name joy-production-p9 up -d

# Audio Service
docker compose --env-file /opt/joy/config/audio.env -f docker-compose.yml --project-name joy-production up -d audio

# Restart service tertentu
docker compose --env-file /opt/joy/config/p9.1/compose.env -f ops/deploy/p9.1-production-compose.yml --project-name joy-production-p9 restart backend
docker compose --env-file /opt/joy/config/audio.env -f docker-compose.yml --project-name joy-production restart audio
```

### 3.2 Memeriksa Status & Kesehatan
```bash
# Cek status container aktif
docker compose --env-file /opt/joy/config/p9.1/compose.env -f /opt/joy/app/ops/deploy/p9.1-production-compose.yml --project-name joy-production-p9 ps

# Cek health check endpoint
curl -s http://127.0.0.1:3000/livez && echo
curl -s http://127.0.0.1:3000/readyz && echo
curl -s http://127.0.0.1:8001/readyz && echo
```

### 3.3 Memeriksa Log Real-Time
```bash
# Log Backend Gateway (melihat request audio & event WS)
docker logs -f --tail 100 joy-production-p9-backend-1

# Log Audio Service (melihat transkripsi STT & sintesis TTS)
docker logs -f --tail 100 joy-production-audio-1

# Log Database PostgreSQL
docker logs -f --tail 50 joy-production-p9-postgres-1
```

---

## 4. Build & Update Image

### 4.1 Build Ulang Backend Gateway
```bash
# Backend image is selected through P9_PRODUCTION_IMAGE in compose.env
cd /opt/joy/app
docker compose --env-file /opt/joy/config/p9.1/compose.env -f /opt/joy/app/ops/deploy/p9.1-production-compose.yml --project-name joy-production-p9 up -d backend

```

### 4.2 Build Ulang Audio Service
```bash
cd /opt/joy/app/audio-service
docker build -t joy-audio:latest -f Dockerfile .
docker compose --env-file /opt/joy/config/audio.env -f /opt/joy/app/docker-compose.yml --project-name joy-production up -d audio
```

---

## 5. Prosedur Backup & Restore Database

### 5.1 Backup PostgreSQL
```bash
mkdir -p /opt/joy/backups
docker exec -t joy-production-p9-postgres-1 pg_dump -U joy -d joy | gzip > /opt/joy/backups/bmo_db_$(date +%Y%m%d_%H%M%S).sql.gz
```

### 5.2 Restore PostgreSQL
```bash
gunzip -c /opt/joy/backups/bmo_db_<timestamp>.sql.gz | docker exec -i joy-production-p9-postgres-1 psql -U joy -d joy
```

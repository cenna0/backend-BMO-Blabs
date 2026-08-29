# Device Speech Arbiter & Hardware Concurrency Synchronization

**Status:** `PRODUCTION_VERIFIED`  
**Components:** `backend/src/p9/services/device-speech-arbiter.service.ts`, `backend/src/device-speech.port.ts`, `backend/prisma/schema.prisma`

Layanan **Device Speech Arbiter** bertindak sebagai pengatur lalu lintas suara tunggal (*single arbiter of speech*) untuk speaker fisik robot Joy (ESP32). Arbiter ini mencegah bentrokan audio antara percakapan suara langsung dari pengguna (`VOICE_CHAT`), ucapan pengingat proaktif dari jadwal (`PROACTIVE_SPEECH`), dan peringatan sistem (`SYSTEM_ALERT`).

---

## 1. Latar Belakang & Masalah Konkurensi

Robot fisik Joy hanya memiliki 1 unit DAC dan 1 speaker fisik. Jika pengguna sedang berbicara (atau backend sedang memproses respons suara pengguna) pada saat jadwal pengingat berbunyi, atau sebaliknya, sistem tidak boleh memutar dua audio bersamaan yang akan merusak pengalaman pengguna dan menyebabkan buffer underrun pada ESP32.

---

## 2. Model Data & Kunci Advisory PostgreSQL

Tabel `DeviceSpeechReservation` menyimpan status sewa kepemilikan suara saat ini:

\`\`\`prisma
enum DeviceSpeechOwnerKind {
  VOICE_CHAT
  PROACTIVE_SPEECH
  SYSTEM_ALERT
}

model DeviceSpeechReservation {
  id                 String                @id @default(uuid()) @db.Uuid
  deviceId           String                @unique @db.Uuid
  ownerKind          DeviceSpeechOwnerKind
  ownerCorrelationId String                @db.Uuid
  generation         Int                   @default(1)
  leaseId            String?               @db.Uuid
  receipt            String?               @db.VarChar(512)
  leaseExpiresAt     DateTime?             @db.Timestamptz(3)
  createdAt          DateTime              @default(now()) @db.Timestamptz(3)
  updatedAt          DateTime              @updatedAt @db.Timestamptz(3)
  device             Device                @relation(fields: [deviceId], references: [id], onDelete: Cascade)
}
\`\`\`

### 2.1 Kunci Advisory Transaksional
Semua operasi mutasi sewa (`acquire`, `promote`, `release`) dieksekusi di dalam transaksi PostgreSQL yang dilindungi oleh advisory lock tingkat transaksi:
\`\`\`sql
SELECT pg_advisory_xact_lock(hashtextextended($deviceId::text, 0));
\`\`\`
Ini memastikan tidak ada dua thread atau worker yang dapat mengubah status sewa perangkat yang sama secara bersamaan.

---

## 3. Operasi Utama Arbiter

### 3.1 `acquire` (Pemesanan Slot Suara)
- **Mode `ACQUIRE_OR_RETURN_EXACT`**:
  - Jika slot kosong atau sewa sebelumnya telah kedaluwarsa (`leaseExpiresAt < now()`), sewa baru diberikan dengan `generation = 1`.
  - Jika slot sedang dipegang oleh pemilik dan korelasi yang sama, mengembalikan data sewa yang ada (idempoten).
  - Jika slot dipegang oleh entitas lain yang masih aktif, mengembalikan `null` (ditolak).
- **Mode `MATCH_ACTIVE_LEASE`**:
  - Memvalidasi bahwa `leaseId` dan `receipt` persis cocok dengan sewa aktif saat ini.

### 3.2 `promote` (Promosi Status Sewa)
Digunakan saat alur berpindah tahap (misalnya dari tahap penawaran proaktif `proactive_offer` ke tahap pemutaran audio aktif `proactive_audio_ready`):
- Memeriksa kesesuaian `fromOwnerKind`, `generation`, `leaseId`, dan `receipt`.
- Memperbarui ke `toOwnerKind`, `nextLeaseId`, `nextReceipt`, dan waktu kedaluwarsa baru secara atomik.

### 3.3 `release` (Pelepasan Sewa)
- Menghapus rekaman `DeviceSpeechReservation` ketika pemutaran selesai (`audio_playback_done` / `proactive_done`) atau dibatalkan (`voice_cancel` / `proactive_failed`).
- Mengembalikan slot perangkat ke status `idle` bebas.

---

## 4. Pemetaan Protokol WebSocket Hardware

| Operasi Arbiter | Event WebSocket Terkait |
|---|---|
| Permintaan Reservasi Voice | `voice_reserve` → `voice_reserve_accepted` / `voice_reserve_rejected` |
| Pembatalan Voice | `voice_cancel` → Pelepasan sewa |
| Kedaluwarsa Voice | `voice_reserve_expired` → Pelepasan sewa |
| Penawaran Proaktif | `proactive_offer` → `proactive_offer_accepted` |
| Eksekusi Audio Proaktif | `proactive_audio_ready` → `proactive_done` / `proactive_failed` |
| Pembatalan Proaktif | `proactive_cancel` → Pelepasan sewa |

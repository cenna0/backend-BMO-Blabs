# Scheduler, Two-Tier NLU & Proactive Speech Delivery

**Status:** `PRODUCTION_VERIFIED`  
**Components:** `backend/src/p9/services/schedule-nlu.ts`, `schedule-intent.ts`, `schedule.service.ts`, `scheduled-result.service.ts`, `device-speech-arbiter.service.ts`

Joy menyediakan kemampuan manajemen jadwal, alarm, dan pengingat proaktif yang dapat dipicu secara percakapan alami melalui suara (ESP32), chat teks aplikasi (Joy Mobile), maupun REST API.

---

## 1. Arsitektur Dua-Tingkat (Two-Tier) Intent NLU

Untuk menjamin responsivitas ultra-cepat sekaligus pemahaman semantik alami yang fleksibel, pemrosesan intent jadwal menggunakan strategi 2 tier:

```text
[ Pesan Pengguna (Teks / Audio STT) ]
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  Tier 1: Fast Regex & Lexical Parser (detectScheduleIntent) │
│  - Normalisasi kata angka Indonesia ("semenit", "2 jam")    │
│  - Pencocokan durasi relatif ("3 jam lagi", "10 menit")     │
│  - Pencocokan jam absolut ("jam 08.30", "19:00 WIB")        │
│  - Ekstraksi tugas inti & pembersihan kata sapaan/perintah  │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               │                               │
        [ Intent Ditemukan ]           [ Intent Tidak Ditemukan ]
               │                               │
               │                               ▼
               │                ┌─────────────────────────────┐
               │                │  Pengecekan hasScheduleCue  │
               │                │  (Toleransi Typo / Elongasi)│
               │                └──────────────┬──────────────┘
               │                               │
               │                        [ Ada Cue Jadwal ]
               │                               │
               │                               ▼
               │                ┌─────────────────────────────┐
               │                │ Tier 2: Hermes LLM Fallback │
               │                │ - Injeksi Waktu Acuan WIB   │
               │                │ - Output Schema JSON Ketat  │
               │                └──────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  Pembuatan Jadwal di Database               │
│  - Model: Schedule & nextRunAt                              │
│  - Target: ["MOBILE", "DEVICE"] (jika ada perangkat aktif)  │
│  - Konfirmasi Alami: "Siap! Joy sudah jadwalkan pengingat..."│
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Rincian Implementasi Intent Parser

### 2.1 Tier 1: Lexical Parser (`detectScheduleIntent`)
1. **Normalisasi Kata Angka Spoken**:
   - Fungsi `normalizeIndonesianWordNumbers()` mengubah kata ucapan menjadi digit numerik:
     - `"semenit"` -> `"1 menit"`, `"sejam"` -> `"1 jam"`, `"setengah jam"` -> `"30 menit"`
     - `"dua puluh lima"` -> `"25"`, `"sepuluh"` -> `"10"`, `"satu"` -> `"1"`, dll.
2. **Pencocokan Pola Waktu**:
   - Relatif: `/(?:dalam\s+)?(\d+)\s*(detik|menit|jam)\s*(?:lagi|ke depan)/`
   - Spesifik: `/(?:jam|pukul)?\s*(\d{1,2})[.:](\d{2})/`
3. **Pembersihan Prompt Tugas**:
   - Menghapus sapaan ("halo joy", "tolong"), kata kerja pengingat ("ingatkan saya", "kasih tau"), kata hubung ("untuk", "buat"), dan keterangan waktu, sehingga menyisakan pesan murni seperti `"minum obat"` atau `"meeting penting"`.

### 2.2 Toleransi Typo & Karakter Memanjang (`hasScheduleCue`)
Jika parsing regex gagal, fungsi `hasScheduleCue` mendeteksi adanya intensi pengingat melalui variasi kata dan elongasi huruf yang umum dalam percakapan informal:
- Typo/elongasi kata kerja: `ingat*`, `ingeeet`, `jadwaal`, `bangun*`, `kabarin`, `alarm`, `remind`.
- Typo/elongasi waktu: `jam*`, `jamm`, `meenit`, `besooook`, `pagiii`, `siang`, `sore`, `malam`.

### 2.3 Tier 2: Hermes LLM Fallback (`extractScheduleIntentWithHermes`)
Jika `hasScheduleCue` bernilai `true`, sistem meminta Hermes mengekstrak parameter jadwal dengan menginjeksi waktu acuan Jakarta (WIB, UTC+7) melalui `formatJakartaReferenceTime(now)`:
- Hermes mengekstrak:
  ```json
  {
    "is_schedule": true,
    "prompt": "meeting dengan tim produk",
    "due_at": "2026-08-27T07:00:00.000Z",
    "exact_time": "14:00",
    "date": "2026-08-27",
    "frequency": "Once",
    "time_label": "jam 14.00 siang nanti"
  }
  ```

---

## 3. Siklus Eksekusi Scheduler (`runScheduler()`)

Layanan scheduler berjalan secara periodik di background backend:

1. **Materialize Due & Missed Runs**:
   - Menemukan jadwal aktif yang waktu `nextRunAt` telah tiba atau terlewat (dalam jendela toleransi 5 menit).
   - Membuat rekaman `ScheduleRun` berstatus `DUE`.
2. **Atomic Lease Claiming**:
   - Worker mengklaim run dengan `claimScheduleRuns({ workerId, leaseMs: 30_000 })` untuk mencegah eksekusi ganda pada lingkungan multi-instance.
3. **Generasi Ucapan Ringkas Hermes (2-10 Kata Spoken Repair Loop)**:
   - `ScheduledResultService` meminta LLM menghasilkan kalimat pengingat lisan ringkas (2 hingga 10 kata) khas karakter Joy (misal: `"Waktunya meeting dengan tim produk sekarang ya!"`).
   - Dilengkapi fungsi validasi `validateScheduleResult` dan fallback otomatis.
4. **Distribusi Multi-Saluran**:
   - **Mobile WebSocket**: Mengirim event `notification`, `chat_message`, dan `schedule_status`.
   - **Mobile Push Notification**: Mengirim notifikasi push Expo ke semua token aktif pengguna via `PushNotificationService`.
   - **Hardware Robot Speech**: Jika target perangkat aktif tersedia, memanggil `deviceSpeech.deliverScheduleOnce()` yang memanfaatkan `DeviceSpeechArbiterService` untuk menyuarakan pengingat langsung di speaker robot Joy.
5. **Pembaruan Recurrence & Status**:
   - Memajukan jadwal berulang (`Daily`, `Weekly`, `Monthly`) ke waktu berikutnya via `advanceOccurrence()`, atau menandai jadwal sekali jalan (`Once`) menjadi `COMPLETED`.
   - Menandai `ScheduleRun` menjadi `SUCCEEDED`.

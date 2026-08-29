# Action Intent & Semantic Execution Specification

**Status:** `PRODUCTION_VERIFIED`  
**Components:** `backend/src/p9/services/schedule-intent.ts`, `backend/src/p9/services/schedule-nlu.ts`, `backend/src/p9/services/spotify-intent.ts`, `backend/src/p9/services/chat.service.ts`

Dokumen ini mendefinisikan arsitektur deteksi intent semantik percakapan dan eksekusi aksi otomatis (Action Intent) pada sistem Joy.

---

## 1. Ikhtisar Intent Percakapan

Ketika pengguna berbicara atau mengetik pesan ke Joy, pesan dipindai terlebih dahulu untuk mendeteksi intensi khusus sebelum dialihkan ke LLM umum:

1. **Schedule / Reminder Intent (`detectScheduleIntent` & `extractScheduleIntentWithHermes`)**:
   - Mendeteksi perintah membuat pengingat, alarm, atau jadwal.
   - Mengonversi waktu relatif/absolut ke zona waktu `Asia/Jakarta` (WIB, UTC+7).
   - Menghasilkan entri `Schedule` dan konfirmasi suara ramah.
2. **Spotify Playback Intent (`detectSpotifyIntent`)**:
   - Mendeteksi perintah kontrol pemutar musik (Play, Pause, Resume, Next, Previous).
   - Mengekstrak judul lagu / artis dan memverifikasi integrasi Spotify pengguna.
   - Menjalankan aksi Spotify Web API via `IntegrationService`.

---

## 2. Spesifikasi Spotify Conversational Intent

### 2.1 Pola Deteksi Aksi
Fungsi `detectSpotifyIntent(text)` mengevaluasi input bahasa Indonesia dan bahasa Inggris:

| Aksi | Contoh Frasa Input | Output Intent |
|---|---|---|
| **`PLAY`** | `"putar lagu komang"`, `"setel tulus di spotify"`, `"play bohemian rhapsody"` | `{ "action": "PLAY", "query": "komang" }` |
| **`PAUSE`** | `"jeda lagunya"`, `"stop musik"`, `"pause"`, `"matikan spotify"` | `{ "action": "PAUSE" }` |
| **`RESUME`** | `"lanjutkan lagu"`, `"play lagi"`, `"resume musik"` | `{ "action": "RESUME" }` |
| **`NEXT`** | `"skip lagu"`, `"lagu berikutnya"`, `"next track"`, `"ganti lagu"` | `{ "action": "NEXT" }` |
| **`PREVIOUS`** | `"lagu sebelumnya"`, `"kembali ke lagu tadi"`, `"previous"` | `{ "action": "PREVIOUS" }` |

### 2.2 Alur Eksekusi & Idempotensi
1. Memeriksa apakah integrasi Spotify pengguna terhubung (`IntegrationStatus.CONNECTED`). Jika belum, membalas instruksi menghubungkan akun di menu Plugins.
2. Menghasilkan `idempotencyKey` unik berbasis `operationId`.
3. Memanggil `integrations.spotifyAction(userId, { action, idempotencyKey, payload, confirmed: true })`.
4. Mengembalikan respons percakapan ceria khas Joy:
   - Play: `"Sedang memutar "Komang" di Spotify! 🎵"`
   - Pause: `"Musik sudah dijeda ya!"`
   - Resume: `"Memutar kembali lagunya! 🎶"`
   - Next: `"Memutar lagu berikutnya!"`

---

## 3. Spesifikasi Schedule Conversational Intent

### 2.1 Alur Dua-Tingkat (Two-Tier NLU)
1. **Tier 1 (Fast Regex / Lexical)**: Mengekstrak angka terucap, jam spesifik, durasi menit/jam, dan prompt tugas.
2. **Tier 2 (Hermes LLM Fallback)**: Jika ada kata kunci pengingat (`hasScheduleCue` bernilai `true`), Hermes NLU mengekstrak entitas jadwal dengan format waktu Jakarta.

### 2.2 Struktur Output Intent Terverifikasi
\`\`\`typescript
export interface DetectedScheduleIntent {
  prompt: string;        // "minum obat"
  dueAt: Date;           // Date object UTC
  frequency: "Once" | "Daily";
  exactTime: string;     // "08:00" (WIB)
  date: string;          // "YYYY-MM-DD"
  timeLabel: string;     // "jam 08.00 besok"
}
\`\`\`

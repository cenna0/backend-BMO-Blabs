# BMO MVP Hardware Handoff Pack — Design

**Tanggal:** 2026-07-26
**Status:** Awaiting written-spec review
**Audience:** Tim hardware/firmware ESP32-S3 dan tim backend BMO

## 1. Tujuan

Membuat paket handoff ringkas agar tim hardware dapat langsung menyesuaikan firmware ESP32-S3 dengan backend voice MVP yang sudah dibuat, tanpa membaca seluruh dokumentasi backend.

Handoff dianggap berhasil jika tim hardware dapat:

1. memahami alur device ↔ backend;
2. mengimplementasikan format audio, WebSocket, upload, download, display, timeout, dan retry secara tepat;
3. membedakan keputusan kontrak dari nilai konfigurasi deployment;
4. menjalankan acceptance test yang hasilnya dapat diperiksa bersama tim backend;
5. menunjukkan bukti integrasi pada physical ESP32.

## 2. Kondisi Saat Ini

- Kontrak canonical sudah tersedia di `docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`.
- Kontrak sudah cocok dengan implementasi backend dan verifier dokumentasi.
- Backend mempunyai fake ESP32 executable sebagai reference behavior.
- Backend test terakhir: 21 file dan 99 test lulus.
- Endpoint staging aktual belum tersedia; dokumentasi masih memakai alamat deployment generik.
- Integrasi physical ESP32 berstatus `NOT_STARTED` dan bergantung pada endpoint staging P6.

Masalah utama bukan kekurangan detail protokol. Masalahnya adalah kontrak canonical panjang dan belum dikemas sebagai jalur implementasi serta verifikasi harian untuk tim hardware.

## 3. Keputusan Desain

Gunakan `Hardware Handoff Pack` sebagai lapisan operasional di atas kontrak canonical.

Aturan authority:

1. `docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md` tetap source of truth protokol.
2. Handoff pack merangkum dan mengurutkan pekerjaan; tidak membuat endpoint, event, error code, atau state baru.
3. `backend/scripts/fake-esp32.ts` menjadi reference behavior executable.
4. Implementasi backend dan test menjadi bukti sisi software.
5. Acceptance test pada physical ESP32 menjadi bukti sisi hardware.
6. Konflik antara handoff pack dan kontrak canonical harus diselesaikan dengan memperbaiki handoff pack, bukan diam-diam mengubah kontrak.

## 4. Struktur Deliverable

```text
docs/hardware-handoff/
├── START-HERE.md
├── FIRMWARE-CHECKLIST.md
├── ACCEPTANCE-TESTS.md
└── STAGING-CONFIG.template.md
```

### 4.1 `START-HERE.md`

Jalur baca maksimal sekitar 10 menit:

- scope voice MVP;
- dependency hardware dan network;
- source of truth;
- status staging;
- konfigurasi runtime yang harus diterima tim hardware;
- happy-path end-to-end;
- state machine ringkas;
- event dan endpoint canonical;
- aturan korelasi `request_id`;
- urutan implementasi firmware;
- link ke checklist, test, kontrak lengkap, dan fake ESP32.

Dokumen ini harus menjelaskan bahwa HTTP `202` dan WebSocket `display_status` dapat tiba dalam urutan berbeda.

### 4.2 `FIRMWARE-CHECKLIST.md`

Checklist dikelompokkan berdasarkan unit firmware:

1. konfigurasi dan secret storage;
2. Wi-Fi/network readiness;
3. WebSocket connection, authentication, heartbeat, dan reconnect;
4. wake word serta recording lifecycle lokal;
5. WAV encoder;
6. UUID v4 dan request state;
7. HTTP upload;
8. WebSocket event handling;
9. MP3 download, buffering, decoding, dan playback;
10. display/expression state;
11. timeout, retry, deduplication, dan recovery;
12. error audio lokal;
13. logging diagnostik tanpa membocorkan token;
14. build/version identification;
15. readiness untuk acceptance test.

Setiap item memakai bentuk:

```text
[ ] Perilaku yang harus dibuat
    Contract: bagian canonical terkait
    Pass: hasil yang dapat diamati
```

### 4.3 `ACCEPTANCE-TESTS.md`

Test dibagi menjadi empat kelompok:

- smoke/happy path;
- protocol validation;
- recovery/reliability;
- physical audio/display behavior.

Setiap test case berisi:

- ID stabil;
- precondition;
- langkah;
- hasil HTTP/WebSocket/device yang diharapkan;
- evidence wajib;
- status `PASS`, `FAIL`, atau `BLOCKED`;
- owner HW/SW/joint.

Minimum skenario:

1. WebSocket auth sukses;
2. auth credential salah;
3. auth timeout;
4. upload WAV valid;
5. upload tanpa WebSocket;
6. format WAV invalid;
7. file terlalu besar;
8. duplicate upload dengan request ID dan body sama;
9. request ID conflict;
10. device busy;
11. reconnect saat `thinking`;
12. reconnect saat `audio_ready`;
13. duplicate `audio_ready` tidak memulai playback kedua;
14. progressive MP3 download dan playback;
15. satu retry download dari awal;
16. MP3 expired;
17. playback done;
18. playback failed;
19. backend `request_failed`;
20. heartbeat dan reconnect backoff;
21. silence stop 2,5 detik;
22. hard recording stop 60 detik;
23. display `idle → thinking → speaking → idle`;
24. display/audio error lokal;
25. setelah setiap terminal path, state kembali siap dan request berikutnya diterima.

Evidence minimum:

- firmware version/build ID;
- timestamp;
- device ID non-secret;
- request ID;
- HTTP status dan error code;
- WebSocket event/close code;
- display transition;
- ukuran serta metadata WAV/MP3;
- hasil audible playback;
- log retry/reconnect;
- hasil akhir dan catatan defect.

### 4.4 `STAGING-CONFIG.template.md`

File ini memisahkan nilai deployment dari aturan protokol.

Isi non-secret:

- deployment status;
- environment name;
- HTTP base URL;
- WebSocket URL;
- health endpoint;
- device ID;
- batas audio aktif;
- tanggal berlaku;
- contact owner;
- cara memperoleh token melalui kanal terpisah;
- smoke-test status.

Aturan security:

- token asli tidak boleh disimpan di Git atau dokumen handoff;
- token tidak boleh muncul di URL atau log;
- tim backend mengirim token melalui kanal privat;
- konfigurasi harus menyatakan `DEPLOYMENT_STATUS=NOT_AVAILABLE` sampai endpoint benar-benar dapat dijangkau dan smoke test lulus.

## 5. Data Flow Firmware

```text
boot
→ load config
→ connect Wi-Fi
→ open WebSocket
→ authenticate
→ idle
→ wake word + record locally
→ stop on 2.5 s silence or 60 s hard limit
→ build canonical WAV
→ create UUID v4
→ POST raw WAV
→ correlate HTTP response and WebSocket events by request_id
→ thinking
→ receive audio_ready
→ GET MP3 progressively
→ start decoder/playback
→ speaking
→ send audio_playback_done or audio_playback_failed
→ idle
```

Firmware menyimpan minimum:

```text
current_request_id
request_state
playback_state
upload_attempt
download_attempt
websocket_auth_state
reconnect_delay
```

State tersebut diperlukan untuk retry idempotent, reconnect, dan pencegahan playback ganda.

## 6. Error dan Recovery

Handoff pack harus memberi keputusan firmware untuk setiap kelas kegagalan:

- retry dengan request ID sama;
- reconnect lalu retry;
- jangan retry payload sama;
- tunggu request aktif;
- perbaiki credential/config;
- tampilkan error serta mainkan audio error lokal;
- bersihkan state dan kembali `idle`.

Error canonical tidak boleh digabung menjadi error generik jika tindakan recovery berbeda.

Race condition wajib dijelaskan:

- `HTTP 202` vs `display_status`;
- reconnect saat pipeline berjalan;
- duplicate `audio_ready`;
- completion event yang belum pasti terkirim;
- audio URL expired;
- koneksi WebSocket digantikan device connection baru.

## 7. Testing Strategy

### 7.1 Bukti backend

Gunakan test backend, documentation verifier, dan fake ESP32 untuk membuktikan kontrak sisi software.

### 7.2 Bukti pre-staging

Tim hardware dapat:

- mengimplementasikan state machine;
- memvalidasi WAV lokal;
- menguji decoder MP3 dengan fixture;
- mencocokkan serializer/parser terhadap contoh payload;
- memakai backend lokal/LAN jika disediakan tim backend.

### 7.3 Bukti staging

Setelah P6:

- backend mengisi staging config non-secret;
- token dikirim terpisah;
- smoke test dilakukan;
- physical ESP32 menjalankan seluruh acceptance matrix;
- defect dicatat memakai request ID dan evidence wajib.

### 7.4 Gate selesai

Integrasi tidak boleh disebut `HARDWARE INTEGRATION VERIFIED` hanya berdasarkan fake ESP32. Status tersebut membutuhkan physical ESP32, progressive playback, display behavior, reconnect, retry, dan acceptance evidence bersama.

## 8. Scope

Termasuk:

- dokumentasi implementasi firmware;
- konfigurasi staging;
- acceptance matrix;
- referensi perilaku executable;
- traceability ke kontrak canonical.

Tidak termasuk:

- perubahan public API;
- perubahan backend;
- pembuatan firmware ESP32 oleh tim software;
- provisioning production;
- OTA;
- Spotify, WhatsApp, atau mobile app;
- penambahan mode display di luar `idle`, `thinking`, `speaking`, dan `error`.

Framework ESP32 tidak diasumsikan. Handoff tetap language/framework-neutral. Reference firmware khusus ESP-IDF atau Arduino dapat ditambahkan kemudian tanpa mengubah kontrak.

## 9. Completion Criteria

Implementation plan dianggap selesai jika:

1. empat file handoff tersedia dan saling terhubung;
2. semua 13 kebutuhan awal user tercakup;
3. provisioning/config, security, lifecycle, versioning, logging, race condition, dan acceptance evidence tercakup;
4. seluruh endpoint, event, header, audio format, error code, timeout, dan retry cocok dengan kontrak v1.0.5 serta backend aktual;
5. tidak ada token asli;
6. status staging tidak menyesatkan;
7. link lokal valid;
8. verifier dokumentasi dan backend regression tetap lulus;
9. tim hardware memiliki checklist yang dapat dicentang dan test case yang dapat diisi tanpa menafsirkan backend internal.

# Runtime Configuration Documentation Sync — 2026-07-26

**Result:** PASS

## Perubahan utama

1. Current STT runtime diubah dari baseline lama `small` menjadi `medium` multilingual CPU INT8.
2. Hotword `BMO` ditambahkan sebagai current runtime decoding context.
3. Kokoro tetap memakai `af_heart` dan speed `0.80` menjadi current deployment target.
4. PRD dinaikkan dari v1.2.0 ke v1.2.1.
5. Consolidated Backend Implementation dinaikkan dari v1.0.5 ke v1.0.6.
6. Hardware Contract v1.0.5 tidak diubah karena public interface tidak berubah.
7. Historical evidence tidak ditulis ulang; nilai lama diberi status historical/superseded.
8. Ditambahkan `backend-mvp/CURRENT-RUNTIME-CONFIG.md` sebagai quick current-value source.
9. Ditambahkan root `README.md` untuk document authority/order.
10. Internal `superpowers/` planning artifacts dikeluarkan dari final handoff package.

## Evidence mapping

| Current decision | Evidence |
|---|---|
| `WHISPER_MODEL=medium` | `backend-mvp/P5-STT-ACCURACY-INVESTIGATION.md` |
| `WHISPER_HOTWORDS=BMO` | `backend-mvp/P5-STT-ACCURACY-INVESTIGATION.md` |
| English/ID/mixed/silence/noise regression remains valid | same |
| `KOKORO_VOICE=af_heart` | P3/P5 evidence |
| `KOKORO_SPEED=0.80` | `backend-mvp/P5-MANUAL-TEST-EVIDENCE.md` + later project decision |
| Real RVC still separate verification | P3/P5 evidence |

## Verification result

- No stale `WHISPER_MODEL=small` remains in authoritative current config documents.
- No stale Kokoro `1.0` is presented as current deployment value.
- Historical `small`/`1.0` occurrences remain only as evidence/history and are explicitly qualified.
- All local Markdown links in final package resolve.
- Hardware Contract hash is unchanged.

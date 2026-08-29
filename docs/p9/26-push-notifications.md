# Mobile Push Notifications Infrastructure & Integration

**Status:** `PRODUCTION_VERIFIED`  
**Components:** `backend/src/p9/services/push-notification.service.ts`, `backend/src/p9/http/push-notification.route.ts`, `backend/prisma/schema.prisma`  
**Provider:** Expo Push Notification API (`https://exp.host/--/api/v2/push/send`)

Layanan Push Notification pada Joy memungkinkan pengiriman notifikasi pengingat jadwal, pembaruan status sistem, dan peringatan langsung ke aplikasi Joy Mobile di perangkat iOS dan Android pengguna.

---

## 1. Arsitektur Komponen

```text
┌─────────────────────────────────────────────────────────────┐
│          Joy Scheduler (ScheduledResultService)             │
└──────────────────────────────┬──────────────────────────────┘
                               │ Memicu pengingat jadwal yang due
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               PushNotificationService                       │
│  - Query semua token aktif milik user dari database         │
│  - Susun payload pesan Expo Push Format                     │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP POST (Batch)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               Expo Push API (exp.host)                      │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               │                               │
        [ Status: "ok" ]              [ Error: DeviceNotRegistered ]
               │                               │
               ▼                               ▼
     Terkirim ke Ponsel            Pruning Otomatis Token dari DB
```

---

## 2. Model Database (`MobilePushToken`)

\`\`\`prisma
model MobilePushToken {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @db.Uuid
  token     String   @unique @db.VarChar(512)
  platform  String   @default("expo") @db.VarChar(32)
  deviceId  String?  @db.VarChar(255)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
\`\`\`

---

## 3. REST API Push Tokens Management

### 3.1 Pendaftaran Token (`POST /api/v1/settings/push-tokens`)
- **Autentikasi**: Wajib Bearer Token.
- **Request Body**:
  \`\`\`json
  {
    "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "platform": "expo",
    "deviceId": "optional-hardware-uuid"
  }
  \`\`\`
- **Response 200**:
  \`\`\`json
  {
    "ok": true,
    "token": {
      "id": "uuid",
      "token": "ExponentPushToken[...]"
    }
  }
  \`\`\`

### 3.2 Pencabutan Token (`DELETE /api/v1/settings/push-tokens`)
- **Request Body / Query**:
  \`\`\`json
  {
    "token": "ExponentPushToken[...]"
  }
  \`\`\`
- **Response 200**:
  \`\`\`json
  {
    "ok": true,
    "success": true
  }
  \`\`\`

### 3.3 Daftar Token Pengguna (`GET /api/v1/settings/push-tokens`)
- **Response 200**:
  \`\`\`json
  {
    "ok": true,
    "tokens": [
      {
        "id": "uuid",
        "token": "ExponentPushToken[...]",
        "platform": "expo",
        "createdAt": "2026-08-27T10:00:00.000Z"
      }
    ]
  }
  \`\`\`

---

## 4. Siklus Pengiriman & Pruning Otomatis

1. **Batching**: Ketika sebuah jadwal pengingat dieksekusi, service mengambil semua token yang terdaftar untuk `userId` terkait dan mengirimkan array pesan sekaligus.
2. **Konfigurasi Notifikasi**:
   - `priority`: `"high"`
   - `sound`: `"default"`
   - `channelId`: `"joy-schedules"` (Android Notification Channel)
3. **Pembersihan Otomatis (Pruning)**:
   - Jika Expo mengembalikan status tiket error dengan detail `DeviceNotRegistered` (aplikasi di-uninstall atau token kedaluwarsa), `PushNotificationService` secara otomatis menghapus token tersebut dari database (`deleteMany`) agar tidak membebani pengiriman berikutnya.

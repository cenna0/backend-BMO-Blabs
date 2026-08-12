import { z } from "zod";

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const boundedText = (max: number) => z.string().min(1).max(max);
const nullableErrorCode = z.string().min(1).max(100).regex(/^[A-Z0-9_]+$/u).nullable();

export const mobileAuthenticateEventSchema = z.object({
  event: z.literal("authenticate"),
  accessToken: z.string().min(1).max(16_384),
}).strict();

export const mobileOutboundEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("chat_thinking"),
    sessionId: uuid,
    messageId: uuid,
  }).strict(),
  z.object({
    event: z.literal("chat_message"),
    sessionId: uuid,
    message: z.object({
      id: uuid,
      sender: z.literal("assistant"),
      text: boundedText(16_384),
      createdAt: timestamp,
    }).strict(),
  }).strict(),
  z.object({
    event: z.literal("device_status"),
    deviceId: uuid,
    online: z.boolean(),
    lastSeenAt: timestamp,
    wifi: z.object({
      connected: z.boolean(),
      rssi: z.number().int().min(-127).max(0).nullable(),
    }).strict(),
    battery: z.object({
      supported: z.boolean(),
      percent: z.number().int().min(0).max(100).nullable(),
    }).strict(),
  }).strict(),
  z.object({
    event: z.literal("voice_processing_status"),
    deviceId: uuid,
    requestId: uuid,
    status: z.enum(["thinking", "audio_ready", "completed", "failed"]),
    errorCode: nullableErrorCode,
  }).strict(),
  z.object({
    event: z.literal("wifi_configuration_status"),
    deviceId: uuid,
    configurationId: uuid,
    status: z.enum(["PENDING", "DELIVERED", "APPLYING", "CONNECTED", "FAILED", "ROLLED_BACK", "SUPERSEDED"]),
    errorCode: nullableErrorCode,
  }).strict(),
  z.object({
    event: z.literal("proactive_delivery_status"),
    deviceId: uuid,
    deliveryId: uuid,
    source: z.enum(["CHAT", "SCHEDULE", "WHATSAPP"]),
    status: z.enum(["PENDING", "READY", "DELIVERING", "DELIVERED", "FAILED", "EXPIRED", "MISSED"]),
    errorCode: nullableErrorCode,
  }).strict(),
  z.object({
    event: z.literal("schedule_status"),
    scheduleId: uuid,
    runId: uuid.nullable(),
    status: z.enum(["ACTIVE", "PAUSED", "CANCELLED", "COMPLETED"]),
    statusLabel: z.enum(["MONITORING", "WEEKLY", "PAUSED", "COMPLETED"]),
  }).strict(),
  z.object({
    event: z.literal("integration_status"),
    integration: z.enum(["whatsapp", "spotify"]),
    status: z.enum(["CONNECTED", "DISCONNECTED", "PENDING", "ERROR"]),
  }).strict(),
  z.object({
    event: z.literal("notification"),
    id: uuid,
    type: z.literal("GENERIC"),
    title: boundedText(120),
    body: boundedText(1_000),
    createdAt: timestamp,
  }).strict(),
]);

export type MobileOutboundEvent = z.infer<typeof mobileOutboundEventSchema>;

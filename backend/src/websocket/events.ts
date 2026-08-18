import { z } from "zod";

const uuidV4 = z.string().uuid().refine((value) => value[14]?.toLowerCase() === "4");

export const inboundEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("authenticate"),
    device_id: z.string().min(1),
    device_token: z.string().min(1),
  }).strict(),
  z.object({
    event: z.literal("audio_playback_done"),
    request_id: uuidV4,
  }).strict(),
  z.object({
    event: z.literal("audio_playback_failed"),
    request_id: uuidV4,
    reason: z.enum(["DOWNLOAD_FAILED", "DECODE_FAILED", "PLAYBACK_FAILED"]),
  }).strict(),
  z.object({
    event: z.literal("wifi_configuration_received"),
    configuration_id: uuidV4,
  }).strict(),
  z.object({
    event: z.literal("wifi_configuration_result"),
    configuration_id: uuidV4,
    status: z.enum(["CONNECTED", "ROLLED_BACK", "FAILED"]),
    rssi: z.number().int().min(-127).max(0).optional(),
    reason: z.enum(["AUTH_FAILED", "SSID_NOT_FOUND", "DHCP_FAILED", "CONNECT_TIMEOUT", "INTERNAL_ERROR"]).optional(),
  }).strict(),
  z.object({
    event: z.literal("device_log"),
    level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
    code: z.string().min(1).max(64).regex(/^[A-Z0-9_]+$/u),
    message: z.string().min(1).max(1_000),
    timestamp: z.string().datetime({ offset: true }).nullable().optional(),
    metadata: z.record(z.string(), z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()])).optional(),
  }).strict(),
  z.object({
    event: z.literal("device_telemetry"),
    wifi_connected: z.boolean(),
    wifi_rssi: z.number().int().min(-127).max(0).nullable().optional(),
    battery_percent: z.number().int().min(0).max(100).nullable().optional(),
    firmware_version: z.string().min(1).max(64).optional(),
  }).strict(),
  z.object({
    event: z.literal("device_settings_applied"),
    version: z.number().int().positive(),
  }).strict(),
  z.object({
    event: z.literal("pairing_mode_request"),
  }).strict(),
]);

export type InboundEvent = z.infer<typeof inboundEventSchema>;

export type BackendState = "idle" | "thinking" | "audio_ready";

export type OutboundEvent =
  | {
      event: "authenticated";
      status: "ok";
      device_id: string;
      backend_state: BackendState;
      active_request_id: string | null;
    }
  | { event: "authentication_failed"; error: "INVALID_DEVICE_CREDENTIALS" }
  | { event: "connection_replaced"; reason: "NEW_CONNECTION_ESTABLISHED" }
  | { event: "display_status"; request_id: string; status: "thinking" }
  | {
      event: "audio_ready";
      request_id: string;
      audio_url: string;
      format: "mp3";
      expires_in_seconds: number;
    }
  | {
      event: "request_failed";
      request_id: string;
      code:
        | "NO_SPEECH"
        | "INVALID_AUDIO"
        | "STT_FAILED"
        | "HERMES_FAILED"
        | "TTS_FAILED"
        | "AUDIO_EXPIRED"
        | "PIPELINE_TIMEOUT"
        | "INTERNAL_ERROR";
      recoverable: true;
    }
  | {
      event: "wifi_configuration";
      configuration_id: string;
      ssid: string;
      security: "OPEN" | "WPA_PSK";
      password?: string;
    }
  | { event: "device_settings"; version: number; settings: { playback_volume: number } }
  | { event: "pairing_code"; code: string; expires_at: string }
  | { event: "pairing_completed"; status: "ok" };

export type PairingCodeEvent = Extract<OutboundEvent, { event: "pairing_code" }>;
export type PairingCompletedEvent = Extract<OutboundEvent, { event: "pairing_completed" }>;
export type PairingBypassEvent = PairingCodeEvent | PairingCompletedEvent;

export const outboundEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("authenticated"), status: z.literal("ok"), device_id: z.string(),
    backend_state: z.enum(["idle", "thinking", "audio_ready"]), active_request_id: uuidV4.nullable(),
  }).strict(),
  z.object({ event: z.literal("authentication_failed"), error: z.literal("INVALID_DEVICE_CREDENTIALS") }).strict(),
  z.object({ event: z.literal("connection_replaced"), reason: z.literal("NEW_CONNECTION_ESTABLISHED") }).strict(),
  z.object({ event: z.literal("display_status"), request_id: uuidV4, status: z.literal("thinking") }).strict(),
  z.object({ event: z.literal("audio_ready"), request_id: uuidV4, audio_url: z.string().url(), format: z.literal("mp3"), expires_in_seconds: z.number().int().nonnegative() }).strict(),
  z.object({ event: z.literal("request_failed"), request_id: uuidV4, code: z.enum(["NO_SPEECH", "INVALID_AUDIO", "STT_FAILED", "HERMES_FAILED", "TTS_FAILED", "AUDIO_EXPIRED", "PIPELINE_TIMEOUT", "INTERNAL_ERROR"]), recoverable: z.literal(true) }).strict(),
  z.object({ event: z.literal("wifi_configuration"), configuration_id: uuidV4, ssid: z.string().min(1).max(32), security: z.enum(["OPEN", "WPA_PSK"]), password: z.string().min(8).max(63).optional() }).strict(),
  z.object({ event: z.literal("device_settings"), version: z.number().int().positive(), settings: z.object({ playback_volume: z.number().int().min(0).max(100) }).strict() }).strict(),
  z.object({ event: z.literal("pairing_code"), code: z.string().regex(/^\d{6}$/u), expires_at: z.string().datetime({ offset: true }) }).strict(),
  z.object({ event: z.literal("pairing_completed"), status: z.literal("ok") }).strict(),
]);

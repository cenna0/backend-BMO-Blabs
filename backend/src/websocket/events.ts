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
    };

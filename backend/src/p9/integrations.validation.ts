import { z } from "zod";

const idempotencyKey = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const uuid = z.string().uuid();
const cursor = z.string().max(128).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[0-9a-f-]{36}$/u);

function normalizePhoneNumber(value: string, context: z.RefinementCtx): string {
  const compact = value.trim().replace(/[\s().-]/gu, "");
  const normalized = compact.startsWith("00") ? `+${compact.slice(2)}` : compact.startsWith("+") ? compact : `+${compact}`;
  if (!/^\+[1-9]\d{7,14}$/u.test(normalized)) {
    context.addIssue({ code: "custom", message: "phoneNumber must be an international phone number" });
    return z.NEVER as never;
  }
  return normalized;
}

const whatsAppRule = z.object({
  scope: z.enum(["ALL", "CONTACT", "GROUP"]),
  conversationId: uuid.optional(),
  enabled: z.boolean().default(true),
  speakOnDevice: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.scope === "ALL" && value.conversationId !== undefined) context.addIssue({ code: "custom", path: ["conversationId"], message: "ALL rules cannot target a conversation" });
  if (value.scope !== "ALL" && value.conversationId === undefined) context.addIssue({ code: "custom", path: ["conversationId"], message: "conversationId is required" });
});

export const whatsappRulesPatchSchema = z.object({ rules: z.array(whatsAppRule).min(1).max(100) }).strict();
export type WhatsAppRuleInput = z.infer<typeof whatsAppRule>;

export const whatsappConversationQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: cursor.optional() }).strict();
export const whatsappRecipientResolveSchema = z.object({
  phoneNumber: z.string().trim().min(1).max(32).transform(normalizePhoneNumber),
  displayName: z.string().trim().min(1).max(120).optional(),
}).strict();

export const whatsappSendPreviewSchema = z.object({
  conversationId: uuid,
  message: z.string().trim().min(1).max(1_000),
  idempotencyKey,
}).strict();

export const whatsappSendConfirmSchema = z.object({
  requestId: z.string().uuid(),
  confirmed: z.literal(true),
}).strict();

export const whatsappConnectSchema = z.object({}).strict();
export const whatsappConfirmScannedSchema = z.object({}).strict();

const spotifyActions = z.enum(["PLAY", "PLAY_TRACK", "PLAY_ARTIST", "PLAY_ALBUM", "PLAY_PLAYLIST", "PAUSE", "RESUME", "NEXT", "PREVIOUS", "TRANSFER", "SEEK", "VOLUME", "SHUFFLE", "REPEAT", "SEARCH"]);
const spotifyPayload = z.record(z.string(), z.union([z.string().max(255), z.number().finite(), z.boolean()])).superRefine((value, context) => {
  if (Object.keys(value).length > 4 || Buffer.byteLength(JSON.stringify(value), "utf8") > 1_000) {
    context.addIssue({ code: "custom", message: "Spotify action payload is too large" });
  }
});
export const spotifyActionSchema = z.object({
  action: spotifyActions,
  idempotencyKey,
  payload: spotifyPayload.default({}),
  confirmed: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  const allowed: Record<string, string[]> = {
    PLAY: ["query", "uri", "targetType", "deviceId", "deviceName"], PLAY_TRACK: ["uri", "deviceId", "deviceName"], PLAY_ARTIST: ["uri", "deviceId", "deviceName"], PLAY_ALBUM: ["uri", "deviceId", "deviceName"], PLAY_PLAYLIST: ["uri", "deviceId", "deviceName"],
    SEARCH: ["query", "types"], TRANSFER: ["deviceId", "deviceName", "play", "preferred"], SEEK: ["positionMs", "deviceId", "deviceName"],
    VOLUME: ["volume", "deviceId", "deviceName"], SHUFFLE: ["state", "deviceId", "deviceName"], REPEAT: ["state", "deviceId", "deviceName"],
    PAUSE: ["deviceId", "deviceName"], RESUME: ["deviceId", "deviceName"], NEXT: ["deviceId", "deviceName"], PREVIOUS: ["deviceId", "deviceName"],
  };
  const keys = Object.keys(value.payload);
  const invalid = keys.find((key) => !allowed[value.action]?.includes(key));
  if (invalid) context.addIssue({ code: "custom", path: ["payload", invalid], message: "Unsupported Spotify action field" });
  if (["PLAY", "SEARCH"].includes(value.action) && value.payload.query !== undefined && typeof value.payload.query !== "string") context.addIssue({ code: "custom", path: ["payload", "query"], message: "query must be text" });
  if (value.action === "PLAY" && value.payload.query === undefined && typeof value.payload.uri !== "string") context.addIssue({ code: "custom", path: ["payload", "uri"], message: "query or uri is required" });
  if (value.action === "PLAY" && typeof value.payload.uri === "string" && !/^spotify:(track|artist|album|playlist):[A-Za-z0-9]+$/u.test(value.payload.uri)) context.addIssue({ code: "custom", path: ["payload", "uri"], message: "uri must be a Spotify URI" });
  if (value.action === "PLAY" && value.payload.targetType !== undefined && !["track", "artist", "album", "playlist"].includes(String(value.payload.targetType))) context.addIssue({ code: "custom", path: ["payload", "targetType"], message: "targetType is invalid" });
  if (["PLAY_TRACK", "PLAY_ARTIST", "PLAY_ALBUM", "PLAY_PLAYLIST"].includes(value.action) && typeof value.payload.uri !== "string") context.addIssue({ code: "custom", path: ["payload", "uri"], message: "uri is required" });
  if (["PLAY_TRACK", "PLAY_ARTIST", "PLAY_ALBUM", "PLAY_PLAYLIST"].includes(value.action) && typeof value.payload.uri === "string") {
    const expected = value.action === "PLAY_TRACK" ? "track" : value.action === "PLAY_ARTIST" ? "artist" : value.action === "PLAY_ALBUM" ? "album" : "playlist";
    if (!new RegExp(`^spotify:${expected}:[A-Za-z0-9]+$`, "u").test(value.payload.uri)) context.addIssue({ code: "custom", path: ["payload", "uri"], message: "uri does not match action type" });
  }
  if (value.action === "TRANSFER" && typeof value.payload.deviceId !== "string" && typeof value.payload.deviceName !== "string") context.addIssue({ code: "custom", path: ["payload", "deviceId"], message: "deviceId or deviceName is required" });
  if (value.action === "TRANSFER" && value.payload.preferred !== undefined && typeof value.payload.preferred !== "boolean") context.addIssue({ code: "custom", path: ["payload", "preferred"], message: "preferred must be boolean" });
  if (value.action === "SEEK" && (!Number.isInteger(value.payload.positionMs) || Number(value.payload.positionMs) < 0 || Number(value.payload.positionMs) > 86_400_000)) context.addIssue({ code: "custom", path: ["payload", "positionMs"], message: "positionMs must be between 0 and 86400000" });
  if (value.action === "SEARCH" && typeof value.payload.query !== "string") context.addIssue({ code: "custom", path: ["payload", "query"], message: "query is required" });
  if (["PLAY", "SEARCH"].includes(value.action) && typeof value.payload.query === "string" && value.payload.query.trim().length === 0) context.addIssue({ code: "custom", path: ["payload", "query"], message: "query is required" });
  if (value.action === "VOLUME" && (!Number.isInteger(value.payload.volume) || Number(value.payload.volume) < 0 || Number(value.payload.volume) > 100)) context.addIssue({ code: "custom", path: ["payload", "volume"], message: "volume must be 0-100" });
  if (value.action === "SHUFFLE" && typeof value.payload.state !== "boolean") context.addIssue({ code: "custom", path: ["payload", "state"], message: "state is required" });
  if (value.action === "REPEAT" && !["track", "context", "off"].includes(String(value.payload.state))) context.addIssue({ code: "custom", path: ["payload", "state"], message: "state must be track, context, or off" });
});

export const spotifyConnectSchema = z.object({}).strict();
export const spotifySearchQuerySchema = z.object({ q: z.string().trim().min(1).max(200), type: z.string().optional() }).strict();
export const spotifyPreferredDeviceSchema = z.object({ deviceId: z.string().trim().min(1).max(255).nullable() }).strict();
export const spotifyCallbackSchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().length(64),
  error: z.string().max(128).optional(),
}).strict();

export const bugReportSchema = z.object({
  category: z.string().trim().min(1).max(64).default("GENERAL"),
  description: z.string().trim().min(1).max(4_000),
  context: z.string().trim().max(4_000).optional(),
  includeScreenshot: z.union([z.boolean(), z.enum(["true", "false"])]).default(false),
}).strict().transform((value) => ({
  ...value,
  includeScreenshot: value.includeScreenshot === true || value.includeScreenshot === "true",
}));

export function parseWhatsAppConversationQuery(value: unknown) { return whatsappConversationQuerySchema.parse(value); }
export function parseWhatsAppRecipientResolve(value: unknown) { return whatsappRecipientResolveSchema.parse(value); }
export function parseWhatsAppRulesPatch(value: unknown) { return whatsappRulesPatchSchema.parse(value); }
export function parseWhatsAppSendPreview(value: unknown) { return whatsappSendPreviewSchema.parse(value); }
export function parseSpotifyAction(value: unknown) { return spotifyActionSchema.parse(value); }
export function parseSpotifySearchQuery(value: unknown) { return spotifySearchQuerySchema.parse(value); }
export function parseBugReportInput(value: unknown) { return bugReportSchema.parse(value); }

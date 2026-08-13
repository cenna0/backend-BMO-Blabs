import { z } from "zod";

const idempotencyKey = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const targetRef = z.string().trim().min(1).max(255);

const whatsAppRule = z.object({
  scope: z.enum(["ALL", "CONTACT", "GROUP"]),
  targetRef: targetRef.optional(),
  enabled: z.boolean().default(true),
  speakOnDevice: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.scope === "ALL" && value.targetRef !== undefined) context.addIssue({ code: "custom", path: ["targetRef"], message: "ALL rules cannot target a contact" });
  if (value.scope !== "ALL" && value.targetRef === undefined) context.addIssue({ code: "custom", path: ["targetRef"], message: "targetRef is required" });
});

export const whatsappRulesPatchSchema = z.object({ rules: z.array(whatsAppRule).min(1).max(100) }).strict();
export type WhatsAppRuleInput = z.infer<typeof whatsAppRule>;

export const whatsappSendPreviewSchema = z.object({
  recipientRef: targetRef,
  message: z.string().trim().min(1).max(1_000),
  idempotencyKey,
}).strict();

export const whatsappSendConfirmSchema = z.object({
  requestId: z.string().uuid(),
  confirmed: z.literal(true),
}).strict();

export const whatsappConnectSchema = z.object({}).strict();
export const whatsappConfirmScannedSchema = z.object({}).strict();

const spotifyActions = z.enum(["PLAY", "PAUSE", "RESUME", "NEXT", "PREVIOUS", "VOLUME", "SHUFFLE", "QUEUE", "SEARCH"]);
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
    PLAY: ["query", "deviceId"], SEARCH: ["query"], QUEUE: ["query", "deviceId"],
    VOLUME: ["volume", "deviceId"], SHUFFLE: ["state", "deviceId"],
    PAUSE: ["deviceId"], RESUME: ["deviceId"], NEXT: ["deviceId"], PREVIOUS: ["deviceId"],
  };
  const keys = Object.keys(value.payload);
  const invalid = keys.find((key) => !allowed[value.action]?.includes(key));
  if (invalid) context.addIssue({ code: "custom", path: ["payload", invalid], message: "Unsupported Spotify action field" });
  if (["PLAY", "SEARCH", "QUEUE"].includes(value.action) && value.action !== "SEARCH" && value.payload.query !== undefined && typeof value.payload.query !== "string") context.addIssue({ code: "custom", path: ["payload", "query"], message: "query must be text" });
  if (value.action === "SEARCH" && typeof value.payload.query !== "string") context.addIssue({ code: "custom", path: ["payload", "query"], message: "query is required" });
  if (value.action === "VOLUME" && (!Number.isInteger(value.payload.volume) || Number(value.payload.volume) < 0 || Number(value.payload.volume) > 100)) context.addIssue({ code: "custom", path: ["payload", "volume"], message: "volume must be 0-100" });
  if (value.action === "SHUFFLE" && typeof value.payload.state !== "boolean") context.addIssue({ code: "custom", path: ["payload", "state"], message: "state is required" });
});

export const spotifyConnectSchema = z.object({}).strict();
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

export function parseWhatsAppRulesPatch(value: unknown) { return whatsappRulesPatchSchema.parse(value); }
export function parseSpotifyAction(value: unknown) { return spotifyActionSchema.parse(value); }
export function parseBugReportInput(value: unknown) { return bugReportSchema.parse(value); }

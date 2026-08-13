import { z } from "zod";

const uuid = z.string().uuid();
const idempotencyKey = z.string().min(1).max(128);
const topic = z.string().trim().min(1).max(120);
const category = z.string().trim().min(1).max(64);
const content = z.string().trim().min(1).max(4_000);
const expiry = z.string().datetime({ offset: true }).nullable();

const settingsPatch = z.object({ automaticMemoryCandidates: z.boolean() }).strict();
const listQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const candidateListQuery = listQuery;
const memoryPatch = z.object({
  idempotencyKey,
  topic: topic.optional(),
  category: category.optional(),
  normalizedContent: content.optional(),
  importance: z.number().int().min(1).max(100).optional(),
  expiresAt: expiry.optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "idempotencyKey"));
const action = z.object({ idempotencyKey }).strict();
const acceptCandidate = action.extend({
  category: category.optional(),
  importance: z.number().int().min(1).max(100).optional(),
  expiresAt: expiry.optional(),
}).strict();
const forgetTopic = action.extend({ topic }).strict();
const summaryFeedback = action.extend({ feedback: z.string().trim().min(1).max(500) }).strict();

export interface MemoryCursor { at: Date; id: string }

export function encodeMemoryCursor(cursor: MemoryCursor): string {
  return Buffer.from(JSON.stringify({ at: cursor.at.toISOString(), id: cursor.id }), "utf8").toString("base64url");
}

export function decodeMemoryCursor(value: string): MemoryCursor {
  try {
    const parsed = z.object({ at: z.string().datetime(), id: uuid }).strict().parse(
      JSON.parse(Buffer.from(z.string().min(1).max(512).parse(value), "base64url").toString("utf8")),
    );
    return { at: new Date(parsed.at), id: parsed.id };
  } catch {
    throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["cursor"], message: "Invalid cursor" }]);
  }
}

export const parseMemorySettingsPatch = (value: unknown) => settingsPatch.parse(value);
export const parseMemoryList = (value: unknown) => listQuery.parse(value);
export const parseCandidateList = (value: unknown) => candidateListQuery.parse(value);
export const parseMemoryPatch = (value: unknown) => memoryPatch.parse(value);
export const parseMemoryAction = (value: unknown) => action.parse(value);
export function parseDeleteMemoryAction(body: unknown, header: string | undefined): z.infer<typeof action> {
  const parsed = z.object({ idempotencyKey: idempotencyKey.optional() }).strict().parse(body ?? {});
  if (parsed.idempotencyKey && header && parsed.idempotencyKey !== header) throw new z.ZodError([
    { code: z.ZodIssueCode.custom, path: ["idempotencyKey"], message: "Conflicting idempotency keys" },
  ]);
  return action.parse({ idempotencyKey: parsed.idempotencyKey ?? header });
}
export const parseAcceptCandidate = (value: unknown) => acceptCandidate.parse(value);
export const parseForgetTopic = (value: unknown) => forgetTopic.parse(value);
export const parseSummaryFeedback = (value: unknown) => summaryFeedback.parse(value);

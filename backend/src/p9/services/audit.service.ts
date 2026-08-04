import type { P9Repositories } from "../db/repositories.js";
import type { RequestContext } from "../types.js";

const SAFE_METADATA_KEYS = new Set([
  "outcome",
  "email",
  "requestId",
  "status",
  "reason",
  "provider",
  "resourceType",
  "resourceId",
  "count",
  "attempts",
  "limit",
]);

const SECRET_KEY = /(password|hash|token|secret|code|credential|authorization|cookie|message|content|key)/i;

export function sanitizeAuditMetadata(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!SAFE_METADATA_KEYS.has(key) || SECRET_KEY.test(key)) continue;
    if (typeof raw === "string" && raw.length <= 256) result[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) result[key] = raw;
    else if (typeof raw === "boolean") result[key] = raw;
  }
  const serialized = JSON.stringify(result);
  return Buffer.byteLength(serialized, "utf8") <= 512 ? result : {};
}

export interface AuditInput {
  eventType: string;
  outcome: "success" | "failure" | "denied";
  actorType: "user" | "device" | "operator" | "system" | "anonymous";
  resourceType: string;
  resourceId?: string;
  userId?: string;
  deviceId?: string;
  context?: RequestContext;
  metadata?: unknown;
}

export class AuditService {
  constructor(private readonly repositories: P9Repositories) {}

  async record(input: AuditInput): Promise<void> {
    await this.repositories.auditEvent.create({
      data: {
        eventType: input.eventType,
        outcome: input.outcome,
        actorType: input.actorType,
        resourceType: input.resourceType,
        metadata: sanitizeAuditMetadata(input.metadata),
        ...(input.resourceId === undefined ? {} : { resourceId: input.resourceId }),
        ...(input.userId === undefined ? {} : { userId: input.userId }),
        ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
        ...(input.context?.requestId === undefined ? {} : { requestId: input.context.requestId }),
      },
    });
  }
}

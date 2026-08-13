import type { PrismaClient } from "../../generated/prisma/client.js";
import type { ScheduleStatus } from "../../generated/prisma/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { normalizeSchedule, nextOccurrence, type ScheduleRecurrence } from "../schedule.recurrence.js";
import type { CreateScheduleInput, SchedulePatchInput } from "../schedule.validation.js";
import type { MobileOutboundEvent } from "../websocket/mobile-events.js";

interface MobileEvents { sendToUser(userId: string, event: MobileOutboundEvent): number }

export class ScheduleService {
  constructor(private readonly options: { client: PrismaClient; repositories: P9Repositories; mobileEvents: MobileEvents }) {}

  async create(userId: string, input: CreateScheduleInput, requestId?: string) {
    const now = await this.options.repositories.databaseNow();
    const normalized = normalizeSchedule(input, new Date(now.getTime() - 1));
    if (normalized.targetDeviceId) await this.#ownedDevice(this.options.repositories, userId, normalized.targetDeviceId);
    const schedule = await this.options.repositories.schedule.create({ data: {
      userId, targetDeviceId: normalized.targetDeviceId, timezone: normalized.timezone,
      recurrence: normalized.recurrence, payload: normalized.payload, nextRunAt: normalized.nextRunAt,
    } });
    await this.options.repositories.auditEvent.create({ data: { eventType: "schedule.created", outcome: "success", actorType: "user", resourceType: "schedule", resourceId: schedule.id, userId, ...(requestId ? { requestId } : {}), metadata: { status: "ACTIVE" } } });
    const result = this.#serialize(schedule);
    this.#emit(userId, schedule, null);
    return result;
  }

  async get(userId: string, id: string) {
    return this.#serialize(await this.#owned(this.options.repositories, userId, id));
  }

  async list(userId: string, query: { limit: number; cursor?: string }) {
    const cursor = query.cursor ? this.#cursor(query.cursor) : undefined;
    const rows = await this.options.repositories.schedule.findMany({
      where: { userId, ...(cursor ? { OR: [{ updatedAt: { lt: cursor.at } }, { updatedAt: cursor.at, id: { gt: cursor.id } }] } : {}) },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return { schedules: page.map((row: any) => this.#serialize(row)), nextCursor: rows.length > query.limit && last ? `${last.updatedAt.toISOString()}|${last.id}` : null };
  }

  async update(userId: string, id: string, input: SchedulePatchInput, requestId?: string) {
    return this.options.client.$transaction(async (transaction) => {
      const repo = new P9Repositories(transaction);
      const current: any = await this.#owned(repo, userId, id);
      if (current.version !== input.version || current.status === "CANCELLED" || current.status === "COMPLETED") throw this.#conflict();
      const previous = { ...(current.recurrence as any), ...(current.payload as any), deviceId: current.targetDeviceId };
      const merged = { ...previous, ...input };
      delete (merged as any).version;
      if (merged.deliveryTargets && !merged.deliveryTargets.includes("DEVICE")) delete (merged as any).deviceId;
      const parsed = (await import("../schedule.validation.js")).parseCreateSchedule(merged);
      const normalized = normalizeSchedule(parsed, await repo.databaseNow());
      if (normalized.targetDeviceId) await this.#ownedDevice(repo, userId, normalized.targetDeviceId);
      const updated = await repo.schedule.updateMany({ where: { id, userId, version: input.version, status: current.status }, data: { recurrence: normalized.recurrence, payload: normalized.payload, targetDeviceId: normalized.targetDeviceId, nextRunAt: normalized.nextRunAt, version: { increment: 1 } } });
      if (updated.count !== 1) throw this.#conflict();
      const result: any = await this.#owned(repo, userId, id);
      await this.#audit(repo, userId, id, "schedule.updated", requestId);
      this.#emit(userId, result, null);
      return this.#serialize(result);
    });
  }

  pause(userId: string, id: string, version: number, requestId?: string) { return this.#transition(userId, id, version, "ACTIVE", "PAUSED", requestId); }
  resume(userId: string, id: string, version: number, requestId?: string) { return this.#transition(userId, id, version, "PAUSED", "ACTIVE", requestId); }
  async cancel(userId: string, id: string, version: number, requestId?: string): Promise<void> { await this.#transition(userId, id, version, ["ACTIVE", "PAUSED"], "CANCELLED", requestId); }

  async listRuns(userId: string, query: { limit: number; cursor?: string; scheduleId?: string }) {
    const cursor = query.cursor ? this.#cursor(query.cursor) : undefined;
    const rows = await this.options.repositories.scheduleRun.findMany({
      where: { schedule: { userId }, ...(query.scheduleId ? { scheduleId: query.scheduleId } : {}), ...(cursor ? { OR: [{ dueAt: { lt: cursor.at } }, { dueAt: cursor.at, id: { gt: cursor.id } }] } : {}) },
      orderBy: [{ dueAt: "desc" }, { id: "asc" }], take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit); const last: any = page.at(-1);
    return { runs: page, nextCursor: rows.length > query.limit && last ? `${last.dueAt.toISOString()}|${last.id}` : null };
  }

  async advanceOccurrence(scheduleId: string, dueAt: Date, recurrence: ScheduleRecurrence): Promise<any | null> {
    const nextRunAt = nextOccurrence(recurrence, dueAt);
    const changed = await this.options.repositories.schedule.updateMany({
      where: { id: scheduleId, status: "ACTIVE", nextRunAt: dueAt },
      data: nextRunAt
        ? { nextRunAt, version: { increment: 1 } }
        : { nextRunAt: null, status: "COMPLETED", completedAt: await this.options.repositories.databaseNow(), version: { increment: 1 } },
    });
    if (changed.count !== 1) return null;
    const schedule: any = await this.options.repositories.schedule.findFirst({ where: { id: scheduleId } });
    if (schedule) this.#emit(schedule.userId, schedule, null);
    return schedule;
  }

  async #transition(userId: string, id: string, version: number, from: ScheduleStatus | ScheduleStatus[], to: "ACTIVE" | "PAUSED" | "CANCELLED", requestId?: string) {
    return this.options.client.$transaction(async (transaction) => {
      const repo = new P9Repositories(transaction);
      await this.#owned(repo, userId, id);
      const statuses = Array.isArray(from) ? from : [from];
      const changed = await repo.schedule.updateMany({ where: { id, userId, version, status: { in: statuses } }, data: { status: to, version: { increment: 1 }, ...(to === "CANCELLED" ? { cancelledAt: await repo.databaseNow(), nextRunAt: null } : {}) } });
      if (changed.count !== 1) throw this.#conflict();
      const result: any = await this.#owned(repo, userId, id);
      await this.#audit(repo, userId, id, `schedule.${to.toLowerCase()}`, requestId);
      this.#emit(userId, result, null);
      return this.#serialize(result);
    });
  }

  async #owned(repo: P9Repositories, userId: string, id: string): Promise<any> {
    const schedule = await repo.schedule.findFirst({ where: { id, userId } });
    if (!schedule) throw new P9Error("OWNERSHIP_DENIED", 404, "Schedule not found");
    return schedule;
  }
  async #ownedDevice(repo: P9Repositories, userId: string, id: string): Promise<void> {
    if (!await repo.device.findFirst({ where: { id, userId, status: "ACTIVE" }, select: { id: true } })) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
  }
  #conflict() { return new P9Error("CONFLICT", 409, "Schedule changed concurrently or cannot transition"); }
  #cursor(value: string) { const separator = value.lastIndexOf("|"); return { at: new Date(value.slice(0, separator)), id: value.slice(separator + 1) }; }
  #label(schedule: any) { return schedule.status === "ACTIVE" ? ((schedule.recurrence as any)?.frequency === "Weekly" ? "WEEKLY" : "MONITORING") : schedule.status === "PAUSED" ? "PAUSED" : "COMPLETED"; }
  #serialize(schedule: any) { return { ...schedule, statusLabel: this.#label(schedule) }; }
  #emit(userId: string, schedule: any, runId: string | null) { this.options.mobileEvents.sendToUser(userId, { event: "schedule_status", scheduleId: schedule.id, runId, status: schedule.status, statusLabel: this.#label(schedule) }); }
  #audit(repo: P9Repositories, userId: string, resourceId: string, eventType: string, requestId?: string) { return repo.auditEvent.create({ data: { eventType, outcome: "success", actorType: "user", resourceType: "schedule", resourceId, userId, ...(requestId ? { requestId } : {}), metadata: {} } }); }
}

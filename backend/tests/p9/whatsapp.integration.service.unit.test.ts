import { describe, expect, it, vi } from "vitest";

import { IntegrationProvider } from "../../src/generated/prisma/enums.js";
import { IntegrationService } from "../../src/p9/services/integration.service.js";

const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000006";
const connectionA = "00000000-0000-4000-8000-000000000002";
const deliveryA = "00000000-0000-4000-8000-000000000003";
const deviceA = "00000000-0000-4000-8000-000000000004";
const now = new Date("2026-08-13T00:00:00.000Z");

function fixture() {
  const connection = { id: connectionA, userId: userA, provider: IntegrationProvider.WHATSAPP, status: "CONNECTED", scopes: [], connectedAt: now };
  const delivery = { id: deliveryA, userId: userA, connectionId: connectionA, provider: IntegrationProvider.WHATSAPP, direction: "INBOUND", status: "RECEIVED", providerMessageRef: "message-1", metadata: null };
  const repositories: any = {
    databaseNow: vi.fn().mockResolvedValue(now),
    integrationConnection: {
      findMany: vi.fn().mockResolvedValue([connection]),
      findUnique: vi.fn().mockResolvedValue(connection),
      findUniqueOrThrow: vi.fn().mockResolvedValue(connection),
      update: vi.fn(async ({ data }: any) => ({ ...connection, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(),
    },
    whatsAppDelivery: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(delivery),
    },
    whatsAppNotificationRule: {
      findMany: vi.fn().mockResolvedValue([{ scope: "CONTACT", opaqueTargetRef: "123@s.whatsapp.net", enabled: true, speakOnDevice: true }]),
    },
    device: { findFirst: vi.fn().mockResolvedValue({ id: deviceA, userId: userA, status: "ACTIVE" }) },
    auditEvent: { create: vi.fn() },
  };
  const inbound = vi.fn().mockResolvedValue(undefined);
  const whatsApp = {
    connect: vi.fn().mockResolvedValue({ status: "connected", externalReference: "bridge-hash" }),
    status: vi.fn().mockResolvedValue({ status: "connected", queueLength: 0, uptime: 1, scriptHash: "bridge-hash", sendReadReceipts: false }),
    poll: vi.fn().mockResolvedValue([{ messageId: "message-1", chatId: "123@s.whatsapp.net", senderId: "123@s.whatsapp.net", body: "hello", isGroup: false }]),
    send: vi.fn().mockResolvedValue({ providerMessageRef: "out-1" }),
  };
  const service = new IntegrationService({ client: {} as any, repositories, publicBaseUrl: "http://127.0.0.1:3010", whatsApp: whatsApp as any, whatsAppInbound: inbound });
  return { repositories, whatsApp, inbound, service, delivery };
}

describe("WhatsApp IntegrationService", () => {
  it("binds a real bridge event to the single authenticated owner, persists sanitized metadata, and enqueues generic delivery", async () => {
    const f = fixture();

    await expect(f.service.pollWhatsApp()).resolves.toEqual({ processed: 1, queued: 1 });
    expect(f.repositories.whatsAppDelivery.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: userA,
      connectionId: connectionA,
      provider: IntegrationProvider.WHATSAPP,
      direction: "INBOUND",
      providerMessageRef: "message-1",
      status: "RECEIVED",
      metadata: JSON.stringify({ chatId: "123@s.whatsapp.net", senderId: "123@s.whatsapp.net", isGroup: false, bodyLength: 5 }),
    }) });
    expect(f.inbound).toHaveBeenCalledWith({ userId: userA, deliveryId: deliveryA, deviceId: deviceA, text: "hello" });
    expect(JSON.stringify(f.repositories.whatsAppDelivery.create.mock.calls[0]?.[0])).not.toContain("hello");
  });

  it("persists connected status only after bridge health succeeds and downgrades a lost bridge", async () => {
    const f = fixture();

    await expect(f.service.connectWhatsApp(userA)).resolves.toMatchObject({ blocked: false, connection: { status: "CONNECTED" } });
    expect(f.whatsApp.connect).toHaveBeenCalledWith(userA);

    f.whatsApp.status.mockResolvedValue({ status: "disconnected", queueLength: 0, uptime: 1, scriptHash: "bridge-hash", sendReadReceipts: false });
    await expect(f.service.whatsappConnection(userA)).resolves.toMatchObject({ status: "ERROR" });
    expect(f.repositories.integrationConnection.update).toHaveBeenCalledWith({ where: { id: connectionA }, data: { status: "ERROR" } });
  });

  it("rejects a second owner from claiming the single Hermes session or sending through it", async () => {
    const f = fixture();
    await expect(f.service.connectWhatsApp(userB)).rejects.toMatchObject({ code: "OWNERSHIP_DENIED", status: 404 });
    expect(f.whatsApp.connect).not.toHaveBeenCalled();

    f.repositories.integrationConnection.findUnique.mockResolvedValue({ ...f.delivery, id: "foreign-row", userId: userB, provider: IntegrationProvider.WHATSAPP, status: "DISCONNECTED" });
    await expect(f.service.whatsappPreview(userB, { recipientRef: "123@s.whatsapp.net", message: "not yours", idempotencyKey: "wa-foreign" })).rejects.toMatchObject({ code: "OWNERSHIP_DENIED", status: 404 });
  });

  it("keeps the persistent Hermes identity bound after BMO metadata disconnect", async () => {
    const f = fixture();
    f.repositories.integrationConnection.findMany.mockResolvedValue([{ id: connectionA, userId: userA, provider: IntegrationProvider.WHATSAPP, status: "DISCONNECTED" }]);

    await expect(f.service.connectWhatsApp(userB)).rejects.toMatchObject({ code: "OWNERSHIP_DENIED", status: 404 });
    expect(f.whatsApp.connect).not.toHaveBeenCalled();
  });

  it("deduplicates provider message IDs and rejects ambiguous multi-owner sessions", async () => {
    const f = fixture();
    f.repositories.whatsAppDelivery.findFirst.mockResolvedValue(f.delivery);
    await expect(f.service.pollWhatsApp()).resolves.toEqual({ processed: 0, queued: 0 });
    expect(f.inbound).not.toHaveBeenCalled();

    f.repositories.integrationConnection.findMany.mockResolvedValue([
      { id: connectionA, userId: userA, provider: IntegrationProvider.WHATSAPP, status: "CONNECTED" },
      { id: "00000000-0000-4000-8000-000000000005", userId: "00000000-0000-4000-8000-000000000006", provider: IntegrationProvider.WHATSAPP, status: "CONNECTED" },
    ]);
    f.repositories.whatsAppDelivery.findFirst.mockResolvedValue(null);
    f.whatsApp.poll.mockResolvedValue([{ messageId: "message-2", chatId: "123@s.whatsapp.net", senderId: "123@s.whatsapp.net", body: "secret", isGroup: false }]);
    await expect(f.service.pollWhatsApp()).resolves.toEqual({ processed: 0, queued: 0 });
    expect(f.inbound).not.toHaveBeenCalled();
  });

  it("requires a group notification rule to name the exact provider chat", async () => {
    const f = fixture();
    f.repositories.whatsAppDelivery.findFirst.mockResolvedValue(null);
    f.repositories.whatsAppNotificationRule.findMany.mockResolvedValue([
      { scope: "GROUP", opaqueTargetRef: "other@g.us", enabled: true, speakOnDevice: true },
    ]);
    f.whatsApp.poll.mockResolvedValue([
      { messageId: "group-1", chatId: "team@g.us", senderId: "123@s.whatsapp.net", body: "hello group", isGroup: true },
    ]);

    await expect(f.service.pollWhatsApp()).resolves.toEqual({ processed: 1, queued: 0 });
    expect(f.inbound).not.toHaveBeenCalled();

    f.repositories.whatsAppDelivery.findFirst.mockResolvedValue(null);
    f.repositories.whatsAppNotificationRule.findMany.mockResolvedValue([
      { scope: "GROUP", opaqueTargetRef: "team@g.us", enabled: true, speakOnDevice: true },
    ]);
    f.whatsApp.poll.mockResolvedValue([
      { messageId: "group-2", chatId: "team@g.us", senderId: "123@s.whatsapp.net", body: "hello group", isGroup: true },
    ]);
    await expect(f.service.pollWhatsApp()).resolves.toEqual({ processed: 1, queued: 1 });
    expect(f.inbound).toHaveBeenCalledWith({ userId: userA, deliveryId: deliveryA, deviceId: deviceA, text: "hello group" });
  });

  it("does not claim a proactive job when the owner has no active device", async () => {
    const f = fixture();
    f.repositories.device.findFirst.mockResolvedValue(null);

    await expect(f.service.pollWhatsApp()).resolves.toEqual({ processed: 1, queued: 0 });
    expect(f.inbound).not.toHaveBeenCalled();
  });
});

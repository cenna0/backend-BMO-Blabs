import { describe, expect, it } from "vitest";

import { mobileOutboundEventSchema } from "../../src/p9/websocket/mobile-events.js";

const id = "00000000-0000-4000-8000-000000000010";
const otherId = "00000000-0000-4000-8000-000000000020";
const createdAt = "2026-08-12T03:00:00.000Z";

describe("mobile realtime outbound event contract", () => {
  it.each([
    { event: "chat_thinking", sessionId: id, messageId: otherId },
    {
      event: "chat_message",
      sessionId: id,
      message: { id: otherId, sender: "assistant", text: "Hi!", createdAt },
    },
    {
      event: "device_status",
      deviceId: id,
      online: true,
      lastSeenAt: createdAt,
      wifi: { connected: true, rssi: -57 },
      battery: { supported: false, percent: null },
    },
    {
      event: "voice_processing_status",
      deviceId: id,
      requestId: otherId,
      status: "audio_ready",
      errorCode: null,
    },
    {
      event: "wifi_configuration_status",
      deviceId: id,
      configurationId: otherId,
      status: "CONNECTED",
      errorCode: null,
    },
    {
      event: "proactive_delivery_status",
      deviceId: id,
      deliveryId: otherId,
      source: "SCHEDULE",
      status: "DELIVERED",
      errorCode: null,
    },
    {
      event: "schedule_status",
      scheduleId: id,
      runId: null,
      status: "ACTIVE",
      statusLabel: "MONITORING",
    },
    { event: "integration_status", integration: "spotify", status: "CONNECTED" },
    {
      event: "notification",
      id,
      type: "GENERIC",
      title: "BMO",
      body: "Safe bounded text",
      createdAt,
    },
  ])("accepts the frozen $event schema", (event) => {
    expect(mobileOutboundEventSchema.safeParse(event).success).toBe(true);
  });

  it("rejects unbounded text and undeclared properties", () => {
    expect(mobileOutboundEventSchema.safeParse({
      event: "notification",
      id,
      type: "GENERIC",
      title: "BMO",
      body: "x".repeat(1_001),
      createdAt,
    }).success).toBe(false);
    expect(mobileOutboundEventSchema.safeParse({
      event: "chat_thinking",
      sessionId: id,
      messageId: otherId,
      accessToken: "must-not-pass",
    }).success).toBe(false);
  });
});

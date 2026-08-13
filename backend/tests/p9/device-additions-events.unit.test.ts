import { describe, expect, it } from "vitest";

import { inboundEventSchema, outboundEventSchema } from "../../src/websocket/events.js";

const id = "00000000-0000-4000-8000-000000000010";

describe("additive device event contracts", () => {
  it.each([
    { event: "wifi_configuration", configuration_id: id, ssid: "Home", security: "OPEN" },
    { event: "device_settings", version: 2, settings: { playback_volume: 80 } },
  ])("accepts backend event $event", (event) => {
    expect(outboundEventSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    { event: "wifi_configuration_received", configuration_id: id },
    { event: "wifi_configuration_result", configuration_id: id, status: "CONNECTED", rssi: -57 },
    { event: "device_log", level: "INFO", code: "BOOT", message: "ready", timestamp: null, metadata: {} },
    { event: "device_telemetry", wifi_connected: true, wifi_rssi: -57, battery_percent: null, firmware_version: "1.2.3" },
    { event: "device_settings_applied", version: 2 },
  ])("accepts ESP event $event", (event) => {
    expect(inboundEventSchema.safeParse(event).success).toBe(true);
  });

  it("rejects secrets and unbounded additive fields", () => {
    expect(inboundEventSchema.safeParse({ event: "device_log", level: "INFO", code: "BOOT", message: "x".repeat(1001), timestamp: null, metadata: {} }).success).toBe(false);
    expect(outboundEventSchema.safeParse({ event: "wifi_configuration", configuration_id: id, ssid: "Home", security: "WPA_PSK", password: "secret", secretCiphertext: "must-not-pass" }).success).toBe(false);
  });
});

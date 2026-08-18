import { describe, expect, it } from "vitest";

import {
  inboundEventSchema,
  outboundEventSchema,
  type PairingBypassEvent,
} from "../../src/websocket/events.js";
import { parsePairingClaim } from "../../src/p9/validation.js";

describe("code-only pairing contracts", () => {
  it("accepts an authenticated hardware pairing-mode request", () => {
    expect(inboundEventSchema.parse({ event: "pairing_mode_request" })).toEqual({
      event: "pairing_mode_request",
    });
  });

  it("accepts pairing code and completion hardware events", () => {
    expect(outboundEventSchema.parse({
      event: "pairing_code",
      code: "123456",
      expires_at: "2026-08-18T12:00:00.000Z",
    })).toEqual({
      event: "pairing_code",
      code: "123456",
      expires_at: "2026-08-18T12:00:00.000Z",
    });
    expect(outboundEventSchema.parse({
      event: "pairing_completed",
      status: "ok",
    })).toEqual({ event: "pairing_completed", status: "ok" });
  });

  it("narrows unbound socket delivery to pairing events only", () => {
    const acceptPairingBypassEvent = (event: PairingBypassEvent) => event;
    expect(acceptPairingBypassEvent({
      event: "pairing_code",
      code: "123456",
      expires_at: "2026-08-18T12:00:00.000Z",
    })).toMatchObject({ event: "pairing_code" });
    expect(acceptPairingBypassEvent({ event: "pairing_completed", status: "ok" })).toEqual({
      event: "pairing_completed",
      status: "ok",
    });
    // @ts-expect-error application-owned events must use the bound additive path
    acceptPairingBypassEvent({ event: "wifi_configuration", configuration_id: "not-pairing" });
  });

  it("accepts only the six-digit code in the Mobile claim body", () => {
    expect(parsePairingClaim({ code: "123456" })).toEqual({ code: "123456" });
    expect(() => parsePairingClaim({
      code: "123456",
      hardwareId: "bmo-001",
      deviceCredential: "should-never-be-accepted",
    })).toThrow();
  });
});

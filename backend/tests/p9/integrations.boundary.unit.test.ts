import { describe, expect, it } from "vitest";

import { encryptProviderToken, decryptProviderToken } from "../../src/p9/integrations.crypto.js";
import { parseBugReportInput, parseSpotifyAction, parseWhatsAppConversationQuery, parseWhatsAppRecipientResolve, parseWhatsAppRulesPatch, parseWhatsAppSendPreview } from "../../src/p9/integrations.validation.js";

describe("integration boundary validation", () => {
  it("encrypts provider tokens with an authenticated, versioned envelope", () => {
    const key = Buffer.alloc(32, 7);
    const encrypted = encryptProviderToken("refresh-secret", key);
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.ciphertext).not.toContain("refresh-secret");
    expect(decryptProviderToken(encrypted, key)).toBe("refresh-secret");
    expect(() => decryptProviderToken(encrypted, Buffer.alloc(32, 8))).toThrow();
  });

  it("rejects provider action payloads and owner-injected fields", () => {
    expect(parseSpotifyAction({ action: "PAUSE", idempotencyKey: "spotify-1", payload: {} })).toEqual({
      action: "PAUSE", idempotencyKey: "spotify-1", payload: {}, confirmed: false,
    });
    expect(() => parseSpotifyAction({ action: "DELETE_ALL", idempotencyKey: "x", payload: {} })).toThrow();
    expect(() => parseSpotifyAction({ action: "PAUSE", idempotencyKey: "x", payload: {}, userId: "attacker" })).toThrow();
    expect(() => parseSpotifyAction({ action: "PAUSE", idempotencyKey: "x", payload: { providerToken: "secret" } })).toThrow();
    expect(parseSpotifyAction({ action: "PLAY_TRACK", idempotencyKey: "x", payload: { uri: "spotify:track:t1", deviceId: "device-1" }, confirmed: true })).toMatchObject({ action: "PLAY_TRACK" });
    expect(parseSpotifyAction({ action: "SEEK", idempotencyKey: "x", payload: { positionMs: 12_000 } })).toMatchObject({ action: "SEEK" });
    expect(parseSpotifyAction({ action: "REPEAT", idempotencyKey: "x", payload: { state: "context" } })).toMatchObject({ action: "REPEAT" });
    expect(() => parseSpotifyAction({ action: "TRANSFER", idempotencyKey: "x", payload: { deviceId: "d1", userId: "attacker" } })).toThrow();
  });

  it("enforces WhatsApp target shape, bounds, and strict rules", () => {
    expect(parseWhatsAppRulesPatch({ rules: [{ scope: "ALL", enabled: true, speakOnDevice: false }] })).toEqual({
      rules: [{ scope: "ALL", enabled: true, speakOnDevice: false }],
    });
    expect(() => parseWhatsAppRulesPatch({ rules: [{ scope: "ALL", targetRef: "unexpected" }] })).toThrow();
    expect(() => parseWhatsAppRulesPatch({ rules: Array.from({ length: 101 }, () => ({ scope: "ALL" })) })).toThrow();
    expect(parseWhatsAppRulesPatch({ rules: [{ scope: "CONTACT", conversationId: "00000000-0000-4000-8000-000000000010", enabled: false, speakOnDevice: false }] })).toMatchObject({ rules: [{ conversationId: "00000000-0000-4000-8000-000000000010", enabled: false }] });
    expect(() => parseWhatsAppRulesPatch({ rules: [{ scope: "CONTACT", targetRef: "123@s.whatsapp.net" }] })).toThrow();
  });

  it("keeps WhatsApp mobile inputs opaque and validates phone resolution", () => {
    expect(parseWhatsAppConversationQuery({ limit: "10" })).toEqual({ limit: 10 });
    expect(parseWhatsAppRecipientResolve({ phoneNumber: "+62 812-3456-7890", displayName: "Rangga" })).toEqual({ phoneNumber: "+6281234567890", displayName: "Rangga" });
    expect(parseWhatsAppSendPreview({ conversationId: "00000000-0000-4000-8000-000000000010", message: "hello", idempotencyKey: "wa-1" })).toMatchObject({ conversationId: "00000000-0000-4000-8000-000000000010" });
    expect(() => parseWhatsAppSendPreview({ recipientRef: "123@s.whatsapp.net", message: "hello", idempotencyKey: "wa-1" })).toThrow();
    expect(() => parseWhatsAppRecipientResolve({ phoneNumber: "not-a-phone" })).toThrow();
  });

  it("bounds bug report text and excludes arbitrary multipart metadata", () => {
    expect(parseBugReportInput({ description: " broken ", includeScreenshot: "true" })).toEqual({
      description: "broken", includeScreenshot: true, category: "GENERAL", context: undefined,
    });
    expect(() => parseBugReportInput({ description: "x", userId: "attacker" })).toThrow();
    expect(() => parseBugReportInput({ description: "x".repeat(4_001) })).toThrow();
  });
});

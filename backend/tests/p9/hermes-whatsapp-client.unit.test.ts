import { describe, expect, it, vi } from "vitest";

import { HermesWhatsAppBridgeClient, HermesWhatsAppProviderError } from "../../src/p9/providers/hermes-whatsapp.client.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("HermesWhatsAppBridgeClient", () => {
  it("reads the verified bridge health contract without treating HTTP health as connected", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ status: "connected", queueLength: 2, scriptHash: "abc123" }));
    const client = new HermesWhatsAppBridgeClient({ baseUrl: "http://127.0.0.1:3001", fetcher });

    await expect(client.status()).resolves.toEqual({ status: "connected", queueLength: 2, uptime: null, scriptHash: "abc123", sendReadReceipts: null });
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:3001/health", expect.objectContaining({ method: "GET" }));
  });

  it("normalizes only the documented inbound message fields and polls the destructive queue", async () => {
    const fetcher = vi.fn().mockResolvedValue(response([
      { messageId: "m1", chatId: "123@s.whatsapp.net", senderId: "123@s.whatsapp.net", body: "hello", isGroup: false, secret: "must-not-leak" },
      { messageId: "bad", chatId: "123@s.whatsapp.net", senderId: "123@s.whatsapp.net", body: "" },
    ]));
    const client = new HermesWhatsAppBridgeClient({ baseUrl: "http://localhost:3001", fetcher });

    await expect(client.poll()).resolves.toEqual([{ messageId: "m1", chatId: "123@s.whatsapp.net", senderId: "123@s.whatsapp.net", senderName: null, chatName: null, body: "hello", isGroup: false, fromOwner: false }]);
    expect(fetcher).toHaveBeenCalledWith("http://localhost:3001/messages", expect.objectContaining({ method: "GET" }));
  });

  it("passes every validated DM and group event without using a transport allowlist as notification policy", async () => {
    const fetcher = vi.fn().mockResolvedValue(response([
      { messageId: "allowed", chatId: "sender-a@s.whatsapp.net", senderId: "sender-a@s.whatsapp.net", body: "hello", isGroup: false },
      { messageId: "unauthorized", chatId: "sender-b@s.whatsapp.net", senderId: "sender-b@s.whatsapp.net", body: "no", isGroup: false },
      { messageId: "group", chatId: "team@g.us", senderId: "sender-c@s.whatsapp.net", body: "group data", isGroup: true },
    ]));
    const client = new HermesWhatsAppBridgeClient({
      baseUrl: "http://127.0.0.1:3001",
      fetcher,
    });

    await expect(client.poll()).resolves.toEqual([
      { messageId: "allowed", chatId: "sender-a@s.whatsapp.net", senderId: "sender-a@s.whatsapp.net", senderName: null, chatName: null, body: "hello", isGroup: false, fromOwner: false },
      { messageId: "unauthorized", chatId: "sender-b@s.whatsapp.net", senderId: "sender-b@s.whatsapp.net", senderName: null, chatName: null, body: "no", isGroup: false, fromOwner: false },
      { messageId: "group", chatId: "team@g.us", senderId: "sender-c@s.whatsapp.net", senderName: null, chatName: null, body: "group data", isGroup: true, fromOwner: false },
    ]);
  });

  it("preserves the official owner-message marker without exposing extra provider fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(response([
      { messageId: "owner", chatId: "contact@s.whatsapp.net", senderId: "contact@s.whatsapp.net", body: "owner typed", isGroup: false, fromOwner: true, phone: "must-not-leak" },
    ]));
    const client = new HermesWhatsAppBridgeClient({
      baseUrl: "http://127.0.0.1:3001",
      fetcher,
    });

    await expect(client.poll()).resolves.toEqual([{ messageId: "owner", chatId: "contact@s.whatsapp.net", senderId: "contact@s.whatsapp.net", senderName: null, chatName: null, body: "owner typed", isGroup: false, fromOwner: true }]);
  });

  it("maps outbound send to the documented bridge payload and returns only the provider message reference", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ success: true, messageId: "out-1", messageIds: ["out-1"] }));
    const client = new HermesWhatsAppBridgeClient({ baseUrl: "http://127.0.0.1:3001", fetcher });

    await expect(client.send("owner-a", "123@s.whatsapp.net", "hello")).resolves.toEqual({ providerMessageRef: "out-1" });
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:3001/send", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ chatId: "123@s.whatsapp.net", message: "hello" }),
    }));
  });

  it("rejects non-loopback bridge URLs and never exposes provider response bodies", async () => {
    expect(() => new HermesWhatsAppBridgeClient({ baseUrl: "https://example.invalid" })).toThrow(HermesWhatsAppProviderError);
    const fetcher = vi.fn().mockResolvedValue(response({ error: "session-secret" }, 503));
    const client = new HermesWhatsAppBridgeClient({ baseUrl: "http://127.0.0.1:3001", fetcher });

    await expect(client.status()).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await expect(client.status()).rejects.not.toThrow("session-secret");
  });
});

import { describe, expect, it, vi } from "vitest";

import { HermesWhatsAppIdentityResolverClient, preferredWhatsAppDestination } from "../../src/p9/providers/hermes-whatsapp-identity.client.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("HermesWhatsAppIdentityResolverClient", () => {
  it("expands phone and LID identities through the authenticated local resolver", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ groups: [["123@s.whatsapp.net", "456@lid"]] }));
    const client = new HermesWhatsAppIdentityResolverClient({ baseUrl: "http://127.0.0.1:3002", token: "t".repeat(32), fetcher });

    await expect(client.expand(["123@s.whatsapp.net"])).resolves.toEqual(["123@s.whatsapp.net", "456@lid"]);
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:3002/resolve", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ identifiers: ["123@s.whatsapp.net"] }),
      headers: expect.objectContaining({ "x-bmo-identity-resolver-token": "t".repeat(32) }),
    }));
  });

  it("keeps the original identity when mapping is unavailable, malformed, or resolver credentials are absent", async () => {
    const unavailable = new HermesWhatsAppIdentityResolverClient({ baseUrl: "http://127.0.0.1:3002", token: "t".repeat(32), fetcher: vi.fn().mockResolvedValue(response({ error: "unavailable" }, 503)) });
    await expect(unavailable.expand(["456@lid"])).resolves.toEqual(["456@lid"]);

    const malformed = new HermesWhatsAppIdentityResolverClient({ baseUrl: "http://127.0.0.1:3002", token: "t".repeat(32), fetcher: vi.fn().mockResolvedValue(response({ groups: [["not-a-provider-identity"]] })) });
    await expect(malformed.expand(["456@lid"])).resolves.toEqual(["456@lid"]);

    const disabled = new HermesWhatsAppIdentityResolverClient({ baseUrl: "http://127.0.0.1:3002" });
    await expect(disabled.expand(["456@lid"])).resolves.toEqual(["456@lid"]);
  });

  it("prefers a mapped LID for provider-correct outbound routing without exposing it in public objects", () => {
    expect(preferredWhatsAppDestination(["123@s.whatsapp.net", "456@lid"])).toBe("456@lid");
    expect(preferredWhatsAppDestination(["123@s.whatsapp.net"])).toBe("123@s.whatsapp.net");
    expect(JSON.stringify({ conversationId: "bmo-conversation" })).not.toContain("@lid");
  });
});

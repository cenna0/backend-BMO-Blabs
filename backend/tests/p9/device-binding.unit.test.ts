import { describe, expect, it, vi } from "vitest";

import { sha256Hex } from "../../src/p9/crypto.js";
import { DeviceBindingService } from "../../src/p9/services/device-binding.service.js";

describe("physical device application binding", () => {
  it("binds only an active hardware row with the authenticated token digest", async () => {
    const token = "physical-device-credential-012345";
    const device = {
      id: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000010",
      hardwareId: "bmo-001",
      tokenHash: sha256Hex(token),
    };
    const repositories = {
      device: { findFirst: vi.fn().mockResolvedValue(device) },
    };

    const result = await new DeviceBindingService(repositories as never).resolve("bmo-001", token);

    expect(repositories.device.findFirst).toHaveBeenCalledWith({
      where: { hardwareId: "bmo-001", status: "ACTIVE" },
      select: { id: true, userId: true, hardwareId: true, tokenHash: true },
    });
    expect(result).toEqual({ deviceId: device.id, userId: device.userId, hardwareId: "bmo-001" });
  });

  it("returns no binding for a token mismatch without disclosing the row", async () => {
    const repositories = {
      device: {
        findFirst: vi.fn().mockResolvedValue({
          id: "00000000-0000-4000-8000-000000000001",
          userId: "00000000-0000-4000-8000-000000000010",
          hardwareId: "bmo-001",
          tokenHash: sha256Hex("other-device-credential-012345"),
        }),
      },
    };

    await expect(new DeviceBindingService(repositories as never).resolve(
      "bmo-001",
      "physical-device-credential-012345",
    )).resolves.toBeNull();
  });
});

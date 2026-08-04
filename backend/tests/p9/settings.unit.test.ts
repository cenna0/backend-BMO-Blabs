import { describe, expect, it } from "vitest";

import { publicDeviceSettings, publicUserSettings } from "../../src/p9/services/settings.service.js";

describe("P9 settings projections", () => {
  it("projects fixed timezone and approved user fields", () => {
    expect(publicUserSettings({
      language: "en",
      responseLength: "STANDARD",
      automaticMemoryCandidates: true,
      timezone: "Asia/Jakarta",
    })).toEqual({
      language: "en",
      responseLength: "standard",
      automaticMemoryCandidates: true,
      timezone: "Asia/Jakarta",
    });
  });

  it("projects only the Prudence voice profile and safe device values", () => {
    expect(publicDeviceSettings({
      displayName: "Desk BMO",
      defaultDevice: true,
      playbackVolume: 80,
      quietHours: { start: "22:00", end: "06:00", timezone: "Asia/Jakarta" },
      notificationBehavior: "ALL",
      voiceProfileId: "prudence",
      speechSpeed: 1,
      enabled: true,
    })).toMatchObject({
      displayName: "Desk BMO",
      voiceProfileId: "prudence",
      speechSpeed: 1,
      timezone: "Asia/Jakarta",
      voice: { model: "en_GB-semaine-medium", speaker: "prudence", speakerId: 0 },
    });
  });
});

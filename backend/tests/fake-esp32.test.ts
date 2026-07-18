import { describe, expect, it } from "vitest";

import { RequestCoordinator } from "../scripts/fake-esp32.js";

const requestId = "550e8400-e29b-41d4-a716-446655440000";
const thinking = { event: "display_status", request_id: requestId, status: "thinking" };
const ready = {
  event: "audio_ready",
  request_id: requestId,
  audio_url: "http://127.0.0.1:3000/audio/6b6a1bc8-55b0-4e88-b62e-289ae089fd54.mp3",
  format: "mp3",
  expires_in_seconds: 300,
};

describe("RequestCoordinator", () => {
  it.each([
    ["HTTP then WebSocket", ["http", "thinking", "ready"]],
    ["WebSocket then HTTP", ["thinking", "ready", "http"]],
  ])("correlates %s observation order", (_name, order) => {
    const coordinator = new RequestCoordinator(requestId);
    for (const item of order) {
      if (item === "http") coordinator.observeHttp(202, { request_id: requestId, status: "processing" });
      if (item === "thinking") coordinator.observeEvent(thinking);
      if (item === "ready") coordinator.observeEvent(ready);
    }

    expect(coordinator.isReadyForDownload()).toBe(true);
    expect(coordinator.claimAudioUrl()).toBe(ready.audio_url);
  });

  it("never claims a duplicate audio_ready twice", () => {
    const coordinator = new RequestCoordinator(requestId);
    coordinator.observeHttp(202, { request_id: requestId, status: "processing" });
    coordinator.observeEvent(thinking);
    coordinator.observeEvent(ready);
    coordinator.observeEvent(ready);

    expect(coordinator.claimAudioUrl()).toBe(ready.audio_url);
    expect(coordinator.claimAudioUrl()).toBeNull();
  });

  it("ignores events for another request", () => {
    const coordinator = new RequestCoordinator(requestId);
    coordinator.observeHttp(202, { request_id: requestId, status: "processing" });
    coordinator.observeEvent({ ...thinking, request_id: "6b6a1bc8-55b0-4e88-b62e-289ae089fd54" });
    coordinator.observeEvent({ ...ready, request_id: "6b6a1bc8-55b0-4e88-b62e-289ae089fd54" });

    expect(coordinator.isReadyForDownload()).toBe(false);
  });
});

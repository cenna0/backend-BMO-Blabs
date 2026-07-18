import { describe, expect, it } from "vitest";

import { validateCanonicalWav } from "../src/utils/wav-validator.js";
import { makePcmWav } from "./helpers/wav.js";

describe("validateCanonicalWav", () => {
  it("accepts PCM signed 16-bit little-endian, 16 kHz, mono", () => {
    const metadata = validateCanonicalWav(makePcmWav({ durationSeconds: 0.25 }), 60);

    expect(metadata).toMatchObject({
      audioFormat: 1,
      bitsPerSample: 16,
      channels: 1,
      sampleRate: 16_000,
    });
    expect(metadata.durationSeconds).toBeCloseTo(0.25, 4);
  });

  it.each([
    ["stereo", { channels: 2 }],
    ["8 kHz", { sampleRate: 8_000 }],
    ["8-bit", { bitsPerSample: 8 }],
    ["IEEE float", { audioFormat: 3 }],
  ])("rejects %s metadata", (_name, options) => {
    expect(() => validateCanonicalWav(makePcmWav(options), 60)).toThrow("INVALID_AUDIO_FORMAT");
  });

  it("rejects corrupt RIFF and truncated chunks", () => {
    const corrupt = makePcmWav();
    corrupt.write("NOPE", 0, "ascii");
    expect(() => validateCanonicalWav(corrupt, 60)).toThrow("INVALID_AUDIO_FORMAT");

    expect(() => validateCanonicalWav(makePcmWav().subarray(0, 42), 60)).toThrow(
      "INVALID_AUDIO_FORMAT",
    );
  });

  it("rejects audio longer than the configured maximum", () => {
    expect(() => validateCanonicalWav(makePcmWav({ durationSeconds: 60.01 }), 60)).toThrow(
      "INVALID_AUDIO_FORMAT",
    );
  });
});

import { describe, expect, it } from "vitest";

import { isUuidV4 } from "../src/utils/uuid.js";

describe("isUuidV4", () => {
  it("accepts RFC 4122 UUID v4 values", () => {
    expect(isUuidV4("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isUuidV4("6B6A1BC8-55B0-4E88-B62E-289AE089FD54")).toBe(true);
  });

  it("rejects other UUID versions and malformed values", () => {
    expect(isUuidV4("550e8400-e29b-11d4-a716-446655440000")).toBe(false);
    expect(isUuidV4("not-a-uuid")).toBe(false);
    expect(isUuidV4("")).toBe(false);
  });
});

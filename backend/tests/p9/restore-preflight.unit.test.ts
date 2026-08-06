import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourcePath = resolve(process.cwd(), "src/p9/operator/validate-restore-config.ts");

describe("P9 restore preflight side-effect boundary", () => {
  it("delegates only to shared validation and contains no lifecycle or plaintext operation", () => {
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain("loadRestoreConfig");
    expect(source).not.toMatch(/spawn|docker|postgres|pg_restore|gpg|mkdir|writeFile|unlink/i);
  });
});

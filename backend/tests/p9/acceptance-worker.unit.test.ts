import { describe, expect, it } from "vitest";

import { validateAcceptanceWorkerConfiguration } from "../../src/p9/operator/acceptance-worker.js";

describe("P9 acceptance worker host/runtime boundaries", () => {
  it("does not revalidate host PostgreSQL password ownership after root URL handoff", () => {
    expect(() => validateAcceptanceWorkerConfiguration({
      P9_ACCEPTANCE_DATABASE: "bmo_restore_acceptance_test",
      P9_POSTGRES_DB: "bmo_restore_acceptance_test",
      P9_POSTGRES_USER: "bmo",
      P9_ACCEPTANCE_MIGRATIONS_DISABLED: "true",
      DATABASE_URL: "postgresql://bmo@postgres/bmo_restore_acceptance_test",
      P9_DATABASE_PASSWORD_FILE: "/host-owned/0600/postgres-password",
    }, "evidence-snapshot")).not.toThrow();
  });
});

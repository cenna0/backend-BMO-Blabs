# Phase 2 Agent Prompt — Frozen Input

Use this prompt only after the Phase 1 docs commit is present and implementation is explicitly authorized.

```text
Implement BMO Phase 2 from the frozen integration contract.

Read docs/integration/00-START-HERE.md through 10-OPERATOR-PROMPT-RUNBOOK.md, the current PRD, and the linked P9 source-of-truth documents. Verify current Git/runtime drift before modifying code.

Mandatory first gate:
- close and verify the Prisma Studio listener on *:5555;
- capture listener/firewall evidence without printing secrets;
- stop if authority to change that runtime is absent.

Start implementation with Slice 1 in docs/integration/04-VPS-IMPLEMENTATION-PLAN.md: integrate the existing P9.1 router into the production Backend API candidate path. Do not build a second API service.

Preserve without protocol change:
- device WSS /ws;
- raw whole-WAV upload via HTTP;
- MP3 delivery via HTTP;
- existing 6-digit pairing semantics.

Mobile realtime is a separate /api/v1/ws contract.

Use additive Prisma migrations. Do not run a production migration or deploy without explicit deployment authorization, backup/rollback gates, and candidate evidence.

For device identity, bind owner-only features only when active Device.hardwareId equals authenticated device_id and Device.tokenHash equals SHA-256(device_token). Preserve legacy voice for a valid runtime credential if no Prisma binding exists.

Never call a backend event physically implemented until a real ESP test proves it. Keep such rows PENDING_PHYSICAL_ESP.

Update implementation status, coverage matrix, schema/architecture/security/tests, and decision register in the same commit as each code slice. Run the final route/schema/WS/public-private drift loop before completion.
```

This prompt does not authorize secrets access, external provider configuration, production migration, deployment, or ESP firmware changes beyond the operator's explicit scope.

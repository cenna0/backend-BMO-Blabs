# P9 / Integration Execution Plan

**Current plan:** [`../integration/04-VPS-IMPLEMENTATION-PLAN.md`](../integration/04-VPS-IMPLEMENTATION-PLAN.md)

The historical P9.1–P9.6 grouping remains useful for lineage, but Phase 2 executes tracer slices against one Backend API and additive schema:

1. Close the port-5555 security gate and integrate the existing P9.1 router into a production-shaped candidate without voice regression.
2. Add target schema migrations and account/profile/personalization surfaces.
3. Establish the physical device identity bridge and separate mobile realtime socket.
4. Add chat/history, memory, and scheduler/proactive delivery.
5. Add device Wi-Fi/log/telemetry/settings data plane; firmware work remains `PENDING_PHYSICAL_ESP`.
6. Add WhatsApp, Spotify, plugin catalog, and bug reports behind provider gates.
7. Complete candidate migration, security/resource/rollback acceptance before a separately authorized production rollout.

At every slice, update the integration status and endpoint/event matrix. Source completion, private candidate verification, public activation, and physical verification are distinct gates.

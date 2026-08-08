import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_IDENTITY_PATH,
  ACCEPTANCE_READINESS_PROBE_TIMEOUT_MS,
  ACCEPTANCE_READINESS_PATH,
  ACCEPTANCE_STARTUP_POLL_INTERVAL_MS,
  ACCEPTANCE_STARTUP_TIMEOUT_MS,
  buildAcceptanceTransportNetworkArgs,
  buildAcceptanceTransportProxyArgs,
  buildAcceptanceRuntimeArgs,
  inspectDockerResource,
  startAcceptanceRuntime,
  statusAcceptanceRuntime,
  stopAcceptanceRuntime,
  verifyAcceptanceTransport,
  verifyAcceptanceTransportNetwork,
  verifyAcceptanceRuntimePrivateNetwork,
  type AcceptanceDocker,
  type AcceptanceRuntimeHttpClient,
  type AcceptanceRuntimeWaitOptions,
} from "../../src/p9/operator/acceptance-runtime.js";
import { buildAcceptanceWorkerArgs } from "../../src/p9/operator/acceptance-cli.js";
import type { AcceptanceConfig } from "../../src/p9/operator/acceptance-config.js";

const config: AcceptanceConfig = {
  database: "bmo_restore_acceptance_test",
  primaryDatabase: "bmo",
  port: 3025,
  bindHost: "127.0.0.1",
  network: "bmo-p9-1_p9_private",
  transportNetwork: "bmo-p9-1-restore-acceptance-transport",
  transportContainer: "bmo-p9-1-restore-acceptance-proxy",
  project: "bmo-p9-1-restore-acceptance",
  container: "bmo-p9-1-restore-acceptance-runtime",
  postgresContainer: "bmo-p9-1-postgres-1",
  image: "bmo-p9.1-candidate:test",
  codeDirectory: "/opt/bmo/app/backend/dist/src",
  internalPort: 3010,
  migrationsDisabled: true,
  postgresUser: "bmo",
  postgresPasswordFile: "/tmp/postgres-password",
  canonicalAcceptancePasswordFile: "/tmp/acceptance-password",
  runtimeEnvFile: "/tmp/acceptance-runtime.env",
};

function fakeDocker(responses: Array<Partial<Awaited<ReturnType<AcceptanceDocker["run"]>>> & { exitCode: number; stdout?: string; stderr?: string }> = []) {
  const calls: string[][] = [];
  const docker: AcceptanceDocker = {
    run: async (args) => {
      calls.push(args);
      const response = responses[calls.length - 1] ?? { exitCode: 0 };
      return { stdout: "", stderr: "", ...response };
    },
  };
  return { docker, calls };
}

function dockerAbsent(name: string) {
  return { exitCode: 1, stdout: "[]\n", stderr: `error: no such object: ${name}\n` };
}

function startupDocker(responses: Array<Partial<Awaited<ReturnType<AcceptanceDocker["run"]>>> & { exitCode: number; stdout?: string; stderr?: string }> = []) {
  return fakeDocker([
    { exitCode: 0 },
    { exitCode: 0, stdout: JSON.stringify({ Name: config.network, Driver: "bridge", Internal: true, Containers: {} }) },
    { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
    dockerAbsent(config.container),
    dockerAbsent(config.transportContainer),
    dockerAbsent(config.transportNetwork),
    { exitCode: 0, stdout: "1\n" },
    { exitCode: 0, stdout: "container-id\n" },
    { exitCode: 0, stdout: "network-id\n" },
    { exitCode: 0, stdout: "proxy-id\n" },
    { exitCode: 0 },
    { exitCode: 0, stdout: `running|${JSON.stringify({ "3010/tcp": [{ HostIp: "127.0.0.1", HostPort: "3025" }] })}\n` },
    { exitCode: 0, stdout: JSON.stringify({ Name: config.transportNetwork, Driver: "bridge", Internal: false, Containers: { proxy: { Name: config.transportContainer } } }) },
    { exitCode: 0, stdout: JSON.stringify({ [config.network]: {} }) },
    ...responses,
  ]);
}

function readinessHttp(responses: Array<{ status: number; body?: unknown } | Error>) {
  const calls: string[] = [];
  const http: AcceptanceRuntimeHttpClient = {
    request: async (path) => {
      calls.push(path);
      const response = responses[calls.length - 1];
      if (response instanceof Error) throw response;
      return response ?? { status: 500 };
    },
  };
  return { http, calls };
}

function deterministicWait(): AcceptanceRuntimeWaitOptions {
  let time = 0;
  return {
    timeoutMs: 20,
    pollIntervalMs: 5,
    now: () => time,
    sleep: async (milliseconds) => { time += milliseconds; },
  };
}

describe("P9 restored-target acceptance runtime", () => {
  it.each([
    ["container", config.container],
    ["network", config.transportNetwork],
  ] as const)("classifies the exact Docker no-such-object response as ABSENT for a %s", async (kind, name) => {
    const { docker, calls } = fakeDocker([
      {
        exitCode: 1,
        stdout: "[]\n",
        stderr: `error: no such object: ${name}\n`,
      },
    ]);

    await expect(inspectDockerResource(docker, { kind, name })).resolves.toMatchObject({
      kind,
      name,
      state: "ABSENT",
    });
    expect(calls).toEqual([
      kind === "container"
        ? ["inspect", "--format", "{{json .Name}}", name]
        : ["network", "inspect", "--format", "{{json .Name}}", name],
    ]);
  });

  it("accepts Docker's formatted-inspect blank stdout with the exact no-such-object stderr", async () => {
    const { docker } = fakeDocker([
      { exitCode: 1, stdout: "\n", stderr: `error: no such object: ${config.container}\n` },
    ]);

    await expect(inspectDockerResource(docker, { kind: "container", name: config.container })).resolves.toMatchObject({
      state: "ABSENT",
    });
  });

  it.each([
    ["container", config.container, `"/${config.container}"\n`],
    ["network", config.transportNetwork, `"${config.transportNetwork}"\n`],
  ] as const)("classifies an exact existing %s as PRESENT", async (kind, name, stdout) => {
    const { docker } = fakeDocker([{ exitCode: 0, stdout }]);

    await expect(inspectDockerResource(docker, { kind, name })).resolves.toMatchObject({
      kind,
      name,
      state: "PRESENT",
    });
  });

  it.each([
    ["daemon unavailable", "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"],
    ["permission denied", "permission denied while trying to connect to the Docker daemon socket"],
    ["unexpected exit code", "unexpected docker failure"],
  ])("returns INSPECTION_ERROR for %s", async (_label, stderr) => {
    const { docker } = fakeDocker([{ exitCode: _label === "unexpected exit code" ? 2 : 1, stderr }]);

    await expect(inspectDockerResource(docker, { kind: "container", name: config.container })).resolves.toMatchObject({
      state: "INSPECTION_ERROR",
      diagnostic: expect.stringContaining(stderr),
    });
  });

  it("returns INSPECTION_ERROR for malformed successful Docker output", async () => {
    const { docker } = fakeDocker([{ exitCode: 0, stdout: "not-json\n" }]);

    await expect(inspectDockerResource(docker, { kind: "container", name: config.container })).resolves.toMatchObject({
      state: "INSPECTION_ERROR",
      diagnostic: expect.stringContaining("not-json"),
    });
  });

  it.each([
    ["container", config.container, `"/${config.container}-similar"\n`],
    ["network", config.transportNetwork, `"${config.transportNetwork}-similar"\n`],
  ] as const)("does not classify a partial/similar %s name as PRESENT", async (kind, name, stdout) => {
    const { docker } = fakeDocker([{ exitCode: 0, stdout }]);

    await expect(inspectDockerResource(docker, { kind, name })).resolves.toMatchObject({
      state: "INSPECTION_ERROR",
    });
  });

  it("does not accept unrelated stderr merely because it contains not found", async () => {
    const { docker } = fakeDocker([
      { exitCode: 1, stdout: "[]\n", stderr: "unrelated lookup failed: target not found in registry\n" },
    ]);

    await expect(inspectDockerResource(docker, { kind: "container", name: config.container })).resolves.toMatchObject({
      state: "INSPECTION_ERROR",
    });
  });

  it("sanitizes secret-bearing Docker inspection diagnostics", async () => {
    const { docker } = fakeDocker([
      {
        exitCode: 2,
        stderr: "docker inspect failed password=synthetic-password P9_JWT_SECRET=synthetic-token\n",
      },
    ]);

    const result = await inspectDockerResource(docker, { kind: "container", name: config.container });
    expect(result.state).toBe("INSPECTION_ERROR");
    expect(result.diagnostic).not.toContain("synthetic-password");
    expect(result.diagnostic).not.toContain("synthetic-token");
  });

  it("fails closed before backend creation when resource inspection errors", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0 },
      { exitCode: 0, stdout: JSON.stringify({ Name: config.network, Driver: "bridge", Internal: true, Containers: {} }) },
      { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
      { exitCode: 1, stdout: "[]\n", stderr: "permission denied while trying to connect to the Docker daemon socket\n" },
    ]);

    await expect(startAcceptanceRuntime(config, docker)).rejects.toThrow(/validation failed|permission denied/);
    expect(calls.some((args) => args[0] === "run")).toBe(false);
  });

  it("fails closed when the exact backend container already exists", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0 },
      { exitCode: 0, stdout: JSON.stringify({ Name: config.network, Driver: "bridge", Internal: true, Containers: {} }) },
      { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
      { exitCode: 0, stdout: `"/${config.container}"\n` },
    ]);

    await expect(startAcceptanceRuntime(config, docker)).rejects.toThrow(/already exists/);
    expect(calls.some((args) => args[0] === "run")).toBe(false);
  });

  it("fails closed when the exact proxy container already exists", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0 },
      { exitCode: 0, stdout: JSON.stringify({ Name: config.network, Driver: "bridge", Internal: true, Containers: {} }) },
      { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
      { exitCode: 1, stdout: "[]\n", stderr: `error: no such object: ${config.container}\n` },
      { exitCode: 0, stdout: `"/${config.transportContainer}"\n` },
    ]);

    await expect(startAcceptanceRuntime(config, docker)).rejects.toThrow(/already exists/);
    expect(calls.some((args) => args[0] === "run")).toBe(false);
  });

  it("fails closed when the exact transport network already exists", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0 },
      { exitCode: 0, stdout: JSON.stringify({ Name: config.network, Driver: "bridge", Internal: true, Containers: {} }) },
      { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
      { exitCode: 1, stdout: "[]\n", stderr: `error: no such object: ${config.container}\n` },
      { exitCode: 1, stdout: "[]\n", stderr: `error: no such object: ${config.transportContainer}\n` },
      { exitCode: 0, stdout: `"${config.transportNetwork}"\n` },
    ]);

    await expect(startAcceptanceRuntime(config, docker)).rejects.toThrow(/already exists/);
    expect(calls.some((args) => args[0] === "run")).toBe(false);
  });

  it("builds a dedicated credential-free proxy transport with loopback-only publication", () => {
    const networkArgs = buildAcceptanceTransportNetworkArgs(config);
    const proxyArgs = buildAcceptanceTransportProxyArgs(config);

    expect(networkArgs).toEqual(expect.arrayContaining([
      "network", "create", "--driver", "bridge",
      "--opt", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
      "--opt", "com.docker.network.bridge.enable_ip_masquerade=false",
      config.transportNetwork,
    ]));
    expect(proxyArgs).toEqual(expect.arrayContaining([
      "run", "--detach",
      "--name", config.transportContainer,
      "--network", config.transportNetwork,
      "--publish", "127.0.0.1:3025:3010",
      config.image,
      "node", "-e",
    ]));
    const joined = proxyArgs.join(" ");
    expect(joined).not.toContain("--env-file");
    expect(joined).not.toContain("P9_DATABASE_PASSWORD");
    expect(joined).not.toContain("P9_POSTGRES_PASSWORD");
    expect(joined).not.toContain("5432");
    expect(joined).toContain("bmo-p9-1-restore-acceptance-runtime:3010");
  });

  it("fails closed when effective Docker publication is absent before any readiness probe", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0, stdout: `running|${JSON.stringify({ "3010/tcp": null })}\n` },
    ]);

    await expect(verifyAcceptanceTransport(config, docker)).rejects.toThrow(/effective.*transport|publication/i);
    expect(calls).toEqual([[
      "inspect",
      "--format",
      "{{.State.Status}}|{{json .NetworkSettings.Ports}}",
      config.transportContainer,
    ]]);
  });

  it("accepts exactly the required loopback mapping", async () => {
    const { docker } = fakeDocker([
      { exitCode: 0, stdout: `running|${JSON.stringify({ "3010/tcp": [{ HostIp: "127.0.0.1", HostPort: "3025" }] })}\n` },
    ]);

    await expect(verifyAcceptanceTransport(config, docker)).resolves.toBeUndefined();
  });

  it.each([
    ["wildcard host", { "3010/tcp": [{ HostIp: "0.0.0.0", HostPort: "3025" }] }],
    ["non-loopback host", { "3010/tcp": [{ HostIp: "192.0.2.10", HostPort: "3025" }] }],
    ["wrong host port", { "3010/tcp": [{ HostIp: "127.0.0.1", HostPort: "3026" }] }],
    ["wrong container port", { "3011/tcp": [{ HostIp: "127.0.0.1", HostPort: "3025" }] }],
  ])("rejects %s effective publication", async (_label, ports) => {
    const { docker } = fakeDocker([
      { exitCode: 0, stdout: `running|${JSON.stringify(ports)}\n` },
    ]);

    await expect(verifyAcceptanceTransport(config, docker)).rejects.toThrow(/effective acceptance transport/);
  });

  it("creates the backend once and starts readiness only after proxy metadata passes", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0 },
      { exitCode: 0, stdout: JSON.stringify({ Name: config.network, Driver: "bridge", Internal: true, Containers: {} }) },
      { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
      dockerAbsent(config.container),
      dockerAbsent(config.transportContainer),
      dockerAbsent(config.transportNetwork),
      { exitCode: 0, stdout: "1\n" },
      { exitCode: 0, stdout: "backend-id\n" },
      { exitCode: 0, stdout: "network-id\n" },
      { exitCode: 0, stdout: "proxy-id\n" },
      { exitCode: 0 },
      { exitCode: 0, stdout: `running|${JSON.stringify({ "3010/tcp": [{ HostIp: "127.0.0.1", HostPort: "3025" }] })}\n` },
      { exitCode: 0, stdout: JSON.stringify({ Name: config.transportNetwork, Driver: "bridge", Internal: false, Containers: { proxy: { Name: config.transportContainer } } }) },
      { exitCode: 0, stdout: JSON.stringify({ [config.network]: {} }) },
      { exitCode: 0, stdout: "running|0\n" },
    ]);
    const { http, calls: httpCalls } = readinessHttp([
      { status: 200, body: { status: "ok", database: "ready" } },
    ]);

    await expect(startAcceptanceRuntime(config, docker, { http })).resolves.toMatchObject({ container: config.container });
    expect(calls.filter((args) => args[0] === "run" && args.includes(config.container))).toHaveLength(1);
    expect(calls.some((args) => args[0] === "run" && args.includes(config.transportContainer))).toBe(true);
    expect(calls.find((args) => args[0] === "network" && args[1] === "connect")).toEqual([
      "network", "connect", config.network, config.transportContainer,
    ]);
    const mappingIndex = calls.findIndex((args) => args[0] === "inspect" && args.some((arg) => arg.includes(".NetworkSettings.Ports")));
    const readinessStateIndex = calls.findIndex((args) => args[0] === "inspect" && args.some((arg) => arg.includes(".State.Status")) && args.includes(config.container));
    expect(mappingIndex).toBeGreaterThanOrEqual(0);
    expect(mappingIndex).toBeLessThan(readinessStateIndex);
    expect(httpCalls).toEqual([ACCEPTANCE_READINESS_PATH]);
  });

  it("cleans the backend, proxy, and dedicated network immediately when effective mapping is absent", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0 },
      { exitCode: 0, stdout: JSON.stringify({ Name: config.network, Driver: "bridge", Internal: true, Containers: {} }) },
      { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
      dockerAbsent(config.container),
      dockerAbsent(config.transportContainer),
      dockerAbsent(config.transportNetwork),
      { exitCode: 0, stdout: "1\n" },
      { exitCode: 0, stdout: "backend-id\n" },
      { exitCode: 0, stdout: "network-id\n" },
      { exitCode: 0, stdout: "proxy-id\n" },
      { exitCode: 0 },
      { exitCode: 0, stdout: `running|${JSON.stringify({ "3010/tcp": null })}\n` },
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0 },
    ]);
    const { http, calls: httpCalls } = readinessHttp([]);

    await expect(startAcceptanceRuntime(config, docker, { http })).rejects.toThrow(/effective.*publication/);
    expect(httpCalls).toHaveLength(0);
    expect(calls.slice(-3)).toEqual([
      ["rm", "--force", config.transportContainer],
      ["rm", "--force", config.container],
      ["network", "rm", config.transportNetwork],
    ]);
    expect(calls).not.toContain(["network", "rm", config.network]);
  });

  it("requires the transport network to be a dedicated non-internal bridge with only the proxy", async () => {
    const { docker } = fakeDocker([
      { exitCode: 0, stdout: JSON.stringify({
        Name: config.transportNetwork,
        Driver: "bridge",
        Internal: false,
        Containers: {
          proxy: { Name: config.transportContainer },
          candidate: { Name: "bmo-p9-1-backend-1" },
        },
      }) },
    ]);

    await expect(verifyAcceptanceTransportNetwork(docker, config)).rejects.toThrow(/dedicated/);
  });

  it("requires the acceptance backend to remain on the private candidate network only", async () => {
    const { docker } = fakeDocker([
      { exitCode: 0, stdout: JSON.stringify({
        [config.network]: {},
        [config.transportNetwork]: {},
      }) },
    ]);

    await expect(verifyAcceptanceRuntimePrivateNetwork(docker, config)).rejects.toThrow(/private candidate network/);
  });

  it("rejects a candidate network that is not internal before creating any acceptance container", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0 },
      { exitCode: 0, stdout: JSON.stringify({ Name: config.network, Driver: "bridge", Internal: false, Containers: {} }) },
    ]);

    await expect(startAcceptanceRuntime(config, docker)).rejects.toThrow(/internal bridge/);
    expect(calls.some((args) => args[0] === "run")).toBe(false);
  });

  it("builds a Docker run that only publishes loopback and targets the restore database", () => {
    const args = buildAcceptanceRuntimeArgs(config);

    expect(args).toEqual(expect.arrayContaining([
      "run",
      "--detach",
      "--name", config.container,
      "--network", config.network,
      "--env-file", config.runtimeEnvFile,
      "--env", "P9_POSTGRES_DB=bmo_restore_acceptance_test",
      "--env", "P9_ACCEPTANCE_MIGRATIONS_DISABLED=true",
      "--mount", "type=bind,source=/opt/bmo/app/backend/dist/src,destination=/app/dist/src,readonly",
      config.image,
      "node", "dist/src/p9/candidate-server.js",
    ]));
    expect(args).not.toEqual(expect.arrayContaining(["--publish", "127.0.0.1:3025:3010"]));
    expect(args.join(" ")).not.toContain("postgres:5432");
    expect(args.join(" ")).not.toContain("P9_ACCEPTANCE_PASSWORD_FILE=");
  });

  it("checks the private network, candidate image, existing target, and empty acceptance identity before starting", async () => {
    const { docker, calls } = startupDocker([{ exitCode: 0, stdout: "running|0\n" }]);
    const { http } = readinessHttp([{ status: 200, body: { status: "ok", database: "ready" } }]);

    await expect(startAcceptanceRuntime(config, docker, { http })).resolves.toMatchObject({ container: config.container, database: config.database });
    expect(calls[0]).toEqual(["network", "inspect", config.network]);
    expect(calls[1]).toEqual(["network", "inspect", "--format", "{{json .}}", config.network]);
    expect(calls[2]).toEqual(["inspect", "--format", "{{.Config.Image}}", "bmo-p9-1-backend-1"]);
    expect(calls[3]).toEqual(["inspect", "--format", "{{json .Name}}", config.container]);
    expect(calls[4]).toEqual(["inspect", "--format", "{{json .Name}}", config.transportContainer]);
    expect(calls[6]?.slice(0, 5)).toEqual(["exec", config.postgresContainer, "psql", "-U", "bmo"]);
    expect(calls[7]?.[0]).toBe("run");
    expect(calls.filter((args) => args[0] === "run")).toHaveLength(2);
  });

  it("keeps the single runtime after a connection-refused first probe and passes on the next probe", async () => {
    const { docker, calls } = startupDocker([{ exitCode: 0, stdout: "running|0\n" }, { exitCode: 0, stdout: "running|0\n" }]);
    const { http, calls: httpCalls } = readinessHttp([
      new Error("connect ECONNREFUSED 127.0.0.1:3025"),
      { status: 200, body: { status: "ok", database: "ready" } },
    ]);

    await expect(startAcceptanceRuntime(config, docker, { http, ...deterministicWait() })).resolves.toMatchObject({ container: config.container });

    expect(httpCalls).toEqual([ACCEPTANCE_READINESS_PATH, ACCEPTANCE_READINESS_PATH]);
    expect(calls.filter((args) => args[0] === "run")).toHaveLength(2);
    expect(calls.some((args) => args[0] === "rm")).toBe(false);
  });

  it("retries several transient connection failures within the startup deadline", async () => {
    const { docker } = startupDocker([
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
    ]);
    const { http, calls } = readinessHttp([
      new Error("connection refused"),
      new Error("connection refused"),
      new Error("connection refused"),
      { status: 200, body: { status: "ok", database: "ready" } },
    ]);

    await expect(startAcceptanceRuntime(config, docker, { http, ...deterministicWait() })).resolves.toBeDefined();
    expect(calls).toHaveLength(4);
  });

  it("fails finitely and cleans the runtime when readiness never succeeds", async () => {
    const { docker, calls } = startupDocker([
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "state P9_ACCEPTANCE_PASSWORD=not-real\n" },
      { exitCode: 0, stdout: "log P9_ACCEPTANCE_PASSWORD=not-real\n" },
      { exitCode: 0 },
    ]);
    const { http } = readinessHttp([
      { status: 503, body: { status: "error", database: "unavailable" } },
      { status: 503, body: { status: "error", database: "unavailable" } },
      { status: 503, body: { status: "error", database: "unavailable" } },
      { status: 503, body: { status: "error", database: "unavailable" } },
      { status: 503, body: { status: "error", database: "unavailable" } },
    ]);

    const failure = await startAcceptanceRuntime(config, docker, { http, ...deterministicWait() }).catch((error) => error);
    expect(String(failure)).toMatch(/timed out|not ready/);
    expect(calls.filter((args) => args[0] === "run")).toHaveLength(2);
    expect(calls.slice(-3)).toEqual([
      ["rm", "--force", config.transportContainer],
      ["rm", "--force", config.container],
      ["network", "rm", config.transportNetwork],
    ]);
    expect(String(failure)).not.toContain("not-real");
  });

  it("fails immediately when the container exits before readiness", async () => {
    const { docker, calls } = startupDocker([
      { exitCode: 0, stdout: "exited|1\n" },
      { exitCode: 0, stdout: "exited|1\n" },
      { exitCode: 0, stdout: "crash P9_ACCEPTANCE_PASSWORD=not-real\n" },
      { exitCode: 0 },
    ]);
    const { http, calls: httpCalls } = readinessHttp([]);

    await expect(startAcceptanceRuntime(config, docker, { http, ...deterministicWait() })).rejects.toThrow(/exited/);
    expect(httpCalls).toHaveLength(0);
    expect(calls.filter((args) => args[0] === "run")).toHaveLength(2);
    expect(calls.slice(-3)).toEqual([
      ["rm", "--force", config.transportContainer],
      ["rm", "--force", config.container],
      ["network", "rm", config.transportNetwork],
    ]);
  });

  it("keeps unexpected readiness statuses not-ready until a valid response", async () => {
    const { docker } = startupDocker([
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
    ]);
    const { http, calls } = readinessHttp([
      { status: 200, body: { status: "ok", database: "unavailable" } },
      { status: 503, body: { status: "ok", database: "ready" } },
      { status: 200, body: { status: "ok", database: "ready" } },
    ]);

    await expect(startAcceptanceRuntime(config, docker, { http, ...deterministicWait() })).resolves.toBeDefined();
    expect(calls).toHaveLength(3);
  });

  it("defines explicit bounded startup defaults", () => {
    expect(ACCEPTANCE_STARTUP_TIMEOUT_MS).toBe(30_000);
    expect(ACCEPTANCE_STARTUP_POLL_INTERVAL_MS).toBe(250);
    expect(ACCEPTANCE_READINESS_PROBE_TIMEOUT_MS).toBe(3_000);
    expect(ACCEPTANCE_READINESS_PATH).toBe("/api/v1/ops/db/readyz");
    expect(ACCEPTANCE_IDENTITY_PATH).toBe("/api/v1/ops/db/identity");
  });

  it("fails before Docker run when the target database does not exist", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0 },
      { exitCode: 0, stdout: JSON.stringify({ Name: config.network, Driver: "bridge", Internal: true, Containers: {} }) },
      { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
      dockerAbsent(config.container),
      dockerAbsent(config.transportContainer),
      dockerAbsent(config.transportNetwork),
      { exitCode: 0, stdout: "\n" },
    ]);

    await expect(startAcceptanceRuntime(config, docker)).rejects.toThrow(/target database/);
    expect(calls.every((args) => args[0] !== "run")).toBe(true);
  });

  it("removes only the confirmed runtime when transport-network creation fails", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0 },
      { exitCode: 0, stdout: JSON.stringify({ Name: config.network, Driver: "bridge", Internal: true, Containers: {} }) },
      { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
      dockerAbsent(config.container),
      dockerAbsent(config.transportContainer),
      dockerAbsent(config.transportNetwork),
      { exitCode: 0, stdout: "1\n" },
      { exitCode: 0, stdout: "container-id\n" },
      { exitCode: 1, stderr: "network create failed" },
      { exitCode: 0 },
    ]);

    await expect(startAcceptanceRuntime(config, docker)).rejects.toThrow(/network create failed/);
    expect(calls.slice(-1)).toEqual([["rm", "--force", config.container]]);
    expect(calls).not.toContain(["network", "rm", config.transportNetwork]);
  });

  it("does not remove a runtime whose Docker creation did not succeed", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0 },
      { exitCode: 0, stdout: JSON.stringify({ Name: config.network, Driver: "bridge", Internal: true, Containers: {} }) },
      { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
      dockerAbsent(config.container),
      dockerAbsent(config.transportContainer),
      dockerAbsent(config.transportNetwork),
      { exitCode: 0, stdout: "1\n" },
      { exitCode: 1, stderr: "runtime create failed" },
    ]);

    await expect(startAcceptanceRuntime(config, docker)).rejects.toThrow(/runtime create failed/);
    expect(calls.some((args) => args[0] === "rm" || (args[0] === "network" && args[1] === "rm"))).toBe(false);
  });

  it("reports only the named acceptance runtime and proves its configured target", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0, stdout: "running|bmo-p9.1-candidate:test\n" },
      { exitCode: 0, stdout: "bmo_restore_acceptance_test\n" },
      { exitCode: 0, stdout: "true\n" },
      { exitCode: 0, stdout: `running|${JSON.stringify({ "3010/tcp": [{ HostIp: "127.0.0.1", HostPort: "3025" }] })}\n` },
      { exitCode: 0, stdout: JSON.stringify({ Name: config.transportNetwork, Driver: "bridge", Internal: false, Containers: { proxy: { Name: config.transportContainer } } }) },
      { exitCode: 0, stdout: JSON.stringify({ [config.network]: {} }) },
    ]);

    await expect(statusAcceptanceRuntime(config, docker)).resolves.toEqual({
      container: config.container,
      database: config.database,
      image: config.image,
      status: "running",
      migrationsDisabled: true,
    });
    expect(calls.map((args) => args[0])).toEqual(["inspect", "exec", "exec", "inspect", "network", "inspect"]);
  });

  it("stops only the exact acceptance container", async () => {
    const { docker, calls } = fakeDocker([{ exitCode: 0 }]);

    await expect(stopAcceptanceRuntime(config, docker)).resolves.toBeUndefined();
    expect(calls).toEqual([
      ["rm", "--force", config.transportContainer],
      ["rm", "--force", config.container],
      ["network", "rm", config.transportNetwork],
    ]);
  });

  it("runs fixture/evidence commands in the backend image without creating PostgreSQL", () => {
    const args = buildAcceptanceWorkerArgs(config, "/tmp/p9-acceptance-state.json", "fixture-status", false);

    expect(args).toEqual(expect.arrayContaining(["run", "--rm", "--network", config.network, "node", "dist/src/p9/operator/acceptance-worker-entrypoint.js", "fixture-status"]));
    expect(args).toEqual(expect.arrayContaining([
      "--tmpfs", "/run/p9-acceptance:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700",
      "--env", "P9_ACCEPTANCE_STATE_FILE=/run/p9-acceptance/fixture-state.json",
      "--env", "P9_ACCEPTANCE_STATE_SOURCE_FILE=/run/secrets/acceptance_state_source",
      "--mount", "type=bind,source=/tmp/p9-acceptance-state.json,destination=/run/secrets/acceptance_state_source,readonly",
    ]));
    expect(args).not.toContain("postgres");
    expect(args).not.toContain("postgres:16.10-alpine3.22");
  });

  it("runs pre-fixture aggregate evidence without creating or mounting state", () => {
    const args = buildAcceptanceWorkerArgs(config, "/tmp/p9-acceptance-state.json", "evidence-snapshot", false, false);
    const joined = args.join(" ");

    expect(joined).toContain("dist/src/p9/operator/acceptance-worker-entrypoint.js evidence-snapshot");
    expect(joined).not.toContain("acceptance_state_source");
    expect(joined).not.toContain("P9_ACCEPTANCE_STATE_FILE=");
    expect(joined).not.toContain("/run/p9-acceptance");
  });

  it("hands the canonical password to a private tmpfs bootstrap, never directly to UID 1000", () => {
    const args = buildAcceptanceWorkerArgs(config, "/tmp/p9-acceptance-state.json", "fixture-create", true);
    const joined = args.join(" ");

    expect(args).toEqual(expect.arrayContaining([
      "--tmpfs", "/run/bmo-p9.1:rw,noexec,nosuid,nodev,mode=0755",
      "--env", "P9_ACCEPTANCE_PASSWORD_FILE=/run/bmo-p9.1/acceptance-password",
      "--env", "P9_ACCEPTANCE_PASSWORD_SOURCE_FILE=/run/secrets/acceptance_password_source",
      "--mount", "type=bind,source=/tmp/acceptance-password,destination=/run/secrets/acceptance_password_source,readonly",
    ]));
    expect(joined).not.toContain("P9_ACCEPTANCE_PASSWORD_FILE=/tmp/acceptance-password");
    expect(joined).not.toContain("synthetic-password");
  });
});

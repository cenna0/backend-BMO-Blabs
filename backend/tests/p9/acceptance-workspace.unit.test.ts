import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ACCEPTANCE_HOST_STATE_FILE_NAME,
  ACCEPTANCE_HOST_GID,
  ACCEPTANCE_HOST_UID,
  ACCEPTANCE_HOST_WORKSPACE_MODE,
  ensureAcceptanceWorkspace,
  validateAcceptanceWorkspace,
  type AcceptanceWorkspaceFs,
} from "../../src/p9/operator/acceptance-workspace.js";

const temporaryRoots: string[] = [];

function workspaceFixture(): { root: string; workspace: string; state: string } {
  const root = mkdtempSync(join(tmpdir(), "p9-acceptance-workspace-test-"));
  temporaryRoots.push(root);
  const workspace = join(root, "p9-acceptance");
  return { root, workspace, state: join(workspace, ACCEPTANCE_HOST_STATE_FILE_NAME) };
}

function protectedState(state: string): void {
  writeFileSync(state, "synthetic-state-only\n", { mode: 0o600 });
  chmodSync(state, 0o600);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("P9 acceptance host fixture workspace", () => {
  it("uses the exact bmo-admin host operator contract", () => {
    expect(ACCEPTANCE_HOST_UID).toBe(1002);
    expect(ACCEPTANCE_HOST_GID).toBe(1002);
  });

  it("creates an absent workspace non-recursively with the protected mode", () => {
    const { workspace, state } = workspaceFixture();

    const result = ensureAcceptanceWorkspace(state);

    expect(result.workspacePath).toBe(workspace);
    expect(existsSync(workspace)).toBe(true);
    expect(lstatSync(workspace).isDirectory()).toBe(true);
    expect(lstatSync(workspace).mode & 0o7777).toBe(ACCEPTANCE_HOST_WORKSPACE_MODE);
    expect(readdirSync(workspace)).toEqual([]);
  });

  it("re-lstats the final directory after an absent-path creation", () => {
    const { workspace, state } = workspaceFixture();

    const result = ensureAcceptanceWorkspace(state);

    expect(result.stateFilePresent).toBe(false);
    expect(lstatSync(workspace).uid).toBe(ACCEPTANCE_HOST_UID);
    expect(lstatSync(workspace).gid).toBe(ACCEPTANCE_HOST_GID);
  });

  it("accepts an existing exact operator-owned workspace", () => {
    const { workspace, state } = workspaceFixture();
    mkdirSync(workspace, { mode: ACCEPTANCE_HOST_WORKSPACE_MODE });

    expect(validateAcceptanceWorkspace(state).workspacePath).toBe(workspace);
  });

  it("handles an EEXIST creation race by validating the final path", () => {
    const { workspace, state } = workspaceFixture();
    let firstLstat = true;
    let mkdirCalls = 0;
    const metadata = {
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
      mode: ACCEPTANCE_HOST_WORKSPACE_MODE,
      uid: process.getuid?.() ?? 0,
      gid: process.getgid?.() ?? 0,
    };
    const fs: AcceptanceWorkspaceFs = {
      lstatSync: (path) => {
        if (path === workspace && firstLstat) {
          firstLstat = false;
          const error = new Error("race") as Error & { code: string };
          error.code = "ENOENT";
          throw error;
        }
        return metadata;
      },
      mkdirSync: () => {
        mkdirCalls += 1;
        const error = new Error("created by another actor") as Error & { code: string };
        error.code = "EEXIST";
        throw error;
      },
      readdirSync: () => [],
    };

    expect(ensureAcceptanceWorkspace(state, { fs }).workspacePath).toBe(workspace);
    expect(mkdirCalls).toBe(1);
  });

  it("rejects a workspace symlink", () => {
    const { root, workspace, state } = workspaceFixture();
    const target = join(root, "real-workspace");
    mkdirSync(target, { mode: ACCEPTANCE_HOST_WORKSPACE_MODE });
    symlinkSync(target, workspace);

    expect(() => validateAcceptanceWorkspace(state)).toThrow(/symlink/);
  });

  it("rejects a workspace regular file", () => {
    const { workspace, state } = workspaceFixture();
    writeFileSync(workspace, "not-a-directory\n", { mode: 0o600 });

    expect(() => validateAcceptanceWorkspace(state)).toThrow(/directory/);
  });

  it.each(["fifo", "device", "socket"])("rejects a %s at the workspace path", () => {
    const { workspace, state } = workspaceFixture();
    const metadata = {
      isDirectory: () => false,
      isFile: () => false,
      isSymbolicLink: () => false,
      mode: 0o600,
      uid: process.getuid?.() ?? 0,
      gid: process.getgid?.() ?? 0,
    };
    const fs: AcceptanceWorkspaceFs = {
      lstatSync: () => metadata,
      mkdirSync: () => undefined,
      readdirSync: () => [],
    };

    expect(() => validateAcceptanceWorkspace(state, { fs })).toThrow(/directory/);
  });

  it("rejects a workspace with the wrong owner", () => {
    const { workspace, state } = workspaceFixture();
    mkdirSync(workspace, { mode: ACCEPTANCE_HOST_WORKSPACE_MODE });

    expect(() => validateAcceptanceWorkspace(state, { expectedUid: 0 })).toThrow(/ownership/);
  });

  it("rejects a workspace with the wrong group", () => {
    const { workspace, state } = workspaceFixture();
    mkdirSync(workspace, { mode: ACCEPTANCE_HOST_WORKSPACE_MODE });

    expect(() => validateAcceptanceWorkspace(state, { expectedGid: 0 })).toThrow(/ownership/);
  });

  it("rejects a workspace with unsafe group-readable mode", () => {
    const { workspace, state } = workspaceFixture();
    mkdirSync(workspace, { mode: 0o750 });
    chmodSync(workspace, 0o750);

    expect(() => validateAcceptanceWorkspace(state)).toThrow(/permissions/);
  });

  it("rejects a world-writable workspace", () => {
    const { workspace, state } = workspaceFixture();
    mkdirSync(workspace, { mode: 0o777 });
    chmodSync(workspace, 0o777);

    expect(() => validateAcceptanceWorkspace(state)).toThrow(/permissions/);
  });

  it("rejects an unexpected regular file without deleting it", () => {
    const { workspace, state } = workspaceFixture();
    mkdirSync(workspace, { mode: ACCEPTANCE_HOST_WORKSPACE_MODE });
    const unexpected = join(workspace, "unexpected.txt");
    writeFileSync(unexpected, "synthetic-only\n", { mode: 0o600 });

    expect(() => validateAcceptanceWorkspace(state)).toThrow(/unexpected/);
    expect(existsSync(unexpected)).toBe(true);
  });

  it("rejects temporary-file residue", () => {
    const { workspace, state } = workspaceFixture();
    mkdirSync(workspace, { mode: ACCEPTANCE_HOST_WORKSPACE_MODE });
    writeFileSync(join(workspace, "fixture-state.json.temporary.tmp"), "synthetic-only\n", { mode: 0o600 });

    expect(() => validateAcceptanceWorkspace(state)).toThrow(/unexpected|temporary/);
  });

  it("rejects a state-file symlink", () => {
    const { root, workspace, state } = workspaceFixture();
    mkdirSync(workspace, { mode: ACCEPTANCE_HOST_WORKSPACE_MODE });
    const target = join(root, "outside-state");
    writeFileSync(target, "synthetic-only\n", { mode: 0o600 });
    symlinkSync(target, state);

    expect(() => validateAcceptanceWorkspace(state)).toThrow(/symlink/);
  });

  it("rejects a state file with unsafe mode", () => {
    const { workspace, state } = workspaceFixture();
    mkdirSync(workspace, { mode: ACCEPTANCE_HOST_WORKSPACE_MODE });
    writeFileSync(state, "synthetic-only\n", { mode: 0o640 });
    chmodSync(state, 0o640);

    expect(() => validateAcceptanceWorkspace(state)).toThrow(/permissions/);
  });

  it("rejects a state file with the wrong owner", () => {
    const { workspace, state } = workspaceFixture();
    mkdirSync(workspace, { mode: ACCEPTANCE_HOST_WORKSPACE_MODE });
    protectedState(state);

    expect(() => validateAcceptanceWorkspace(state, { expectedUid: 0 })).toThrow(/ownership/);
  });

  it("reports a valid protected state file without permitting another child", () => {
    const { workspace, state } = workspaceFixture();
    mkdirSync(workspace, { mode: ACCEPTANCE_HOST_WORKSPACE_MODE });
    protectedState(state);

    expect(validateAcceptanceWorkspace(state).stateFilePresent).toBe(true);
    expect(readdirSync(workspace)).toEqual(["fixture-state.json"]);
  });

  it("does not recursively remove an unsafe workspace", () => {
    const { workspace, state } = workspaceFixture();
    mkdirSync(workspace, { mode: ACCEPTANCE_HOST_WORKSPACE_MODE });
    const unexpected = join(workspace, "foreign");
    mkdirSync(unexpected, { mode: 0o700 });
    writeFileSync(join(unexpected, "nested"), "synthetic-only\n", { mode: 0o600 });

    expect(() => validateAcceptanceWorkspace(state)).toThrow(/unexpected/);
    expect(existsSync(join(unexpected, "nested"))).toBe(true);
  });

  it("rejects a missing parent when validation, rather than preparation, is requested", () => {
    const { state, workspace } = workspaceFixture();

    expect(() => validateAcceptanceWorkspace(state)).toThrow(/unavailable/);
    expect(existsSync(workspace)).toBe(false);
  });

  it("rejects a non-absolute state path", () => {
    expect(() => ensureAcceptanceWorkspace("tmp/p9-acceptance/fixture-state.json")).toThrow(/absolute/);
  });

  it("rejects a state path with an unexpected basename", () => {
    const { workspace } = workspaceFixture();

    expect(() => ensureAcceptanceWorkspace(join(workspace, "other.json"))).toThrow(/fixture-state.json/);
  });
});

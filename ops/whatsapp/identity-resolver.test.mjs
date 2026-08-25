import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildIdentityIndex, createIdentityResolverServer, expandProviderIdentities } from "./bmo-whatsapp-identity-resolver.mjs";

function fixtureDirectory() {
  return mkdtempSync(join(tmpdir(), "bmo-whatsapp-identity-resolver-"));
}

test("resolves forward phone-to-LID and reverse LID-to-phone mapping files", () => {
  const directory = fixtureDirectory();
  writeFileSync(join(directory, "lid-mapping-123.json"), JSON.stringify("456"), { mode: 0o600 });
  writeFileSync(join(directory, "lid-mapping-456_reverse.json"), JSON.stringify("123"), { mode: 0o600 });
  writeFileSync(join(directory, "creds.json"), JSON.stringify({ noise: "ignored" }), { mode: 0o600 });

  const index = buildIdentityIndex(directory);
  equal(index.fileCount, 2);
  equal(index.reverseFileCount, 1);
  deepStrictEqual(expandProviderIdentities(index, ["123@s.whatsapp.net"]), [["123@s.whatsapp.net", "456@lid"]]);
  deepStrictEqual(expandProviderIdentities(index, ["456@lid"]), [["123@s.whatsapp.net", "456@lid"]]);
});

test("refreshes automatically when a mapping appears after an initially unknown inbound identity", () => {
  const directory = fixtureDirectory();
  let index = buildIdentityIndex(directory);
  deepStrictEqual(expandProviderIdentities(index, ["789@lid"]), [["789@lid"]]);

  writeFileSync(join(directory, "lid-mapping-321.json"), JSON.stringify("789"), { mode: 0o600 });
  chmodSync(join(directory, "lid-mapping-321.json"), 0o600);
  index = buildIdentityIndex(directory);
  deepStrictEqual(expandProviderIdentities(index, ["789@lid"]), [["321@s.whatsapp.net", "789@lid"]]);
});

test("ignores invalid mapping values and never reads arbitrary session files", () => {
  const directory = fixtureDirectory();
  writeFileSync(join(directory, "lid-mapping-111.json"), JSON.stringify({ creds: "must-not-be-read-as-a-mapping" }), { mode: 0o600 });
  writeFileSync(join(directory, "lid-mapping-222.json"), JSON.stringify("not-a-numeric-identity"), { mode: 0o600 });
  const index = buildIdentityIndex(directory);
  equal(index.fileCount, 0);
  ok(!index.edges.has("111@s.whatsapp.net"));
});

test("requires the resolver token and returns only requested equivalence groups", async (t) => {
  const directory = fixtureDirectory();
  writeFileSync(join(directory, "lid-mapping-123.json"), JSON.stringify("456"), { mode: 0o600 });
  const server = createIdentityResolverServer({ sessionDir: directory, token: "r".repeat(32), port: 0 });
  await once(server, "listening");
  t.after(() => server.close());
  const port = server.address().port;

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  deepStrictEqual(await health.json(), { status: "ok", mappingFiles: 1, reverseMappingFiles: 0 });

  const unauthorized = await fetch(`http://127.0.0.1:${port}/resolve`, { method: "POST", body: JSON.stringify({ identifiers: ["123@s.whatsapp.net"] }) });
  equal(unauthorized.status, 401);

  const resolved = await fetch(`http://127.0.0.1:${port}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bmo-identity-resolver-token": "r".repeat(32) },
    body: JSON.stringify({ identifiers: ["123@s.whatsapp.net"] }),
  });
  deepStrictEqual(await resolved.json(), { groups: [["123@s.whatsapp.net", "456@lid"]] });
});

test("selects the identity mapping directory by connection id", async (t) => {
  const root = fixtureDirectory();
  const connectionA = join(root, "connection-a");
  mkdirSync(connectionA, { recursive: true });
  writeFileSync(join(connectionA, "lid-mapping-123.json"), JSON.stringify("456"), { mode: 0o600 });
  const server = createIdentityResolverServer({ sessionsRoot: root, token: "r".repeat(32), port: 0 });
  await once(server, "listening");
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bmo-identity-resolver-token": "r".repeat(32) },
    body: JSON.stringify({ connectionId: "connection-a", identifiers: ["123@s.whatsapp.net"] }),
  });
  deepStrictEqual(await response.json(), { groups: [["123@s.whatsapp.net", "456@lid"]] });
});

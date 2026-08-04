import { describe, expect, it } from "vitest";

type JsonObject = Record<string, any>;

const integration = process.env.P9_INTEGRATION === "true";
const baseUrl = (process.env.P9_TEST_BASE_URL ?? "http://backend:3010/api/v1").replace(/\/$/, "");
const invitationA = process.env.P9_TEST_INVITATION_A;
const invitationB = process.env.P9_TEST_INVITATION_B;
const configuredEmailA = process.env.P9_TEST_EMAIL_A;
const configuredEmailB = process.env.P9_TEST_EMAIL_B;
const password = process.env.P9_TEST_PASSWORD ?? "P9-Integration-Password-2026!";

async function callApi(path: string, init: RequestInit = {}): Promise<{ status: number; body: JsonObject | undefined }> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as JsonObject : undefined };
}

function json(method: string, path: string, body: unknown, accessToken?: string) {
  const headers = accessToken ? { authorization: `Bearer ${accessToken}` } : undefined;
  return callApi(path, {
    method,
    body: JSON.stringify(body),
    ...(headers ? { headers } : {}),
  });
}

function get(path: string, accessToken?: string) {
  const headers = accessToken ? { authorization: `Bearer ${accessToken}` } : undefined;
  return callApi(path, headers ? { headers } : {});
}

function required(value: unknown): JsonObject {
  expect(value).toBeDefined();
  return value as JsonObject;
}

describe.skipIf(!integration)("P9.1 candidate HTTP acceptance", () => {
  it("runs the invite-only auth, session, ownership, pairing, and settings contracts", async () => {
    expect(invitationA).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(invitationB).toMatch(/^[A-Za-z0-9_-]+$/);

    const suffix = `${Date.now()}`;
    const emailA = configuredEmailA ?? `p9-a-${suffix}@example.com`;
    const emailB = configuredEmailB ?? `p9-b-${suffix}@example.com`;
    const registration = await json("POST", "/auth/register", {
      invitationToken: invitationA,
      email: emailA,
      password,
      displayName: "P9 User A",
    });
    expect(registration.status).toBe(201);
    const registrationBody = required(registration.body);
    const sessionA = required(registrationBody.session);
    const userA = required(registrationBody.user);
    const accessA = String(sessionA.accessToken);
    const refreshA = String(sessionA.refreshToken);
    expect(userA.email).toBe(emailA);
    expect(JSON.stringify(registration.body)).not.toMatch(/passwordHash|tokenHash|pairingCode/);

    const login = await json("POST", "/auth/login", { email: emailA.toUpperCase(), password });
    expect(login.status).toBe(200);
    const loginBody = required(login.body);
    const accessLogin = String(required(loginBody.session).accessToken);
    expect(required(loginBody.user).email).toBe(emailA);

    const badLogin = await json("POST", "/auth/login", { email: emailA, password: "wrong-password" });
    expect(badLogin.status).toBe(401);
    expect(badLogin.body).toEqual({ error: "AUTHENTICATION_FAILED", message: "Authentication failed" });

    const me = await get("/me", accessLogin);
    expect(me.status).toBe(200);
    expect(required(required(me.body).user).id).toBe(userA.id);

    const userSettings = await json("PATCH", "/settings/user", {
      language: "en",
      responseLength: "brief",
      automaticMemoryCandidates: false,
      timezone: "Europe/Berlin",
    }, accessLogin);
    expect(userSettings.status).toBe(400);
    const fixedUserSettings = await json("PATCH", "/settings/user", {
      language: "en",
      responseLength: "brief",
      automaticMemoryCandidates: false,
    }, accessLogin);
    expect(fixedUserSettings.status).toBe(200);
    expect(required(fixedUserSettings.body).settings).toMatchObject({ responseLength: "brief", timezone: "Asia/Jakarta" });

    const firstChallenge = await json("POST", "/pairing/challenges", {}, accessLogin);
    expect(firstChallenge.status).toBe(201);
    const firstChallengeBody = required(firstChallenge.body);
    const firstPairingId = String(firstChallengeBody.pairingId);
    const firstCode = String(firstChallengeBody.code);
    expect(firstCode).toMatch(/^\d{6}$/);

    const secondChallenge = await json("POST", "/pairing/challenges", {}, accessLogin);
    expect(secondChallenge.status).toBe(201);
    const secondChallengeBody = required(secondChallenge.body);
    const secondPairingId = String(secondChallengeBody.pairingId);
    const secondCode = String(secondChallengeBody.code);
    expect((await get(`/pairing/${firstPairingId}`, accessLogin)).body?.pairing?.status).toBe("invalidated");

    const staleClaim = await json("POST", `/pairing/${firstPairingId}/claim`, {
      code: firstCode,
      hardwareId: `hw-stale-${suffix}`,
      deviceName: "Stale Device",
      deviceCredential: "stale-device-credential-012345",
    }, accessLogin);
    expect(staleClaim.status).toBe(409);

    const claim = await json("POST", `/pairing/${secondPairingId}/claim`, {
      code: secondCode,
      hardwareId: `hw-${suffix}`,
      deviceName: "P9 Device",
      deviceCredential: "device-credential-0123456789",
    }, accessLogin);
    expect(claim.status).toBe(201);
    const device = required(required(claim.body).device);
    const deviceId = String(device.id);
    expect(JSON.stringify(claim.body)).not.toMatch(/tokenHash|deviceCredential/);

    const replayClaim = await json("POST", `/pairing/${secondPairingId}/claim`, {
      code: secondCode,
      hardwareId: `hw-replay-${suffix}`,
      deviceName: "Replay Device",
      deviceCredential: "replay-device-credential-012345",
    }, accessLogin);
    expect(replayClaim.status).toBe(409);

    const devices = await get("/devices", accessLogin);
    expect(devices.status).toBe(200);
    expect(required(devices.body).devices).toHaveLength(1);
    const deviceSettings = await json("PATCH", `/settings/devices/${deviceId}`, {
      displayName: "P9 Device Updated",
      playbackVolume: 55,
      quietHours: { start: "22:00", end: "06:00", timezone: "Asia/Jakarta" },
      voiceProfileId: "prudence",
      speechSpeed: 0.9,
    }, accessLogin);
    expect(deviceSettings.status).toBe(200);
    expect(required(deviceSettings.body).settings).toMatchObject({
      playbackVolume: 55,
      timezone: "Asia/Jakarta",
      voice: { model: "en_GB-semaine-medium", speaker: "prudence", speakerId: 0 },
    });
    expect((await json("PATCH", `/settings/devices/${deviceId}`, { voiceProfileId: "unsupported" }, accessLogin)).status).toBe(400);
    expect((await get(`/devices/not-a-uuid`, accessLogin)).status).toBe(404);

    const rotated = await json("POST", "/auth/refresh", { refreshToken: refreshA });
    expect(rotated.status).toBe(200);
    const rotatedSession = required(required(rotated.body).session);
    expect(rotatedSession.refreshToken).not.toBe(refreshA);
    expect((await json("POST", "/auth/refresh", { refreshToken: refreshA })).status).toBe(401);

    expect((await json("POST", "/auth/logout", {}, String(rotatedSession.accessToken))).status).toBe(204);
    expect((await get("/me", String(rotatedSession.accessToken))).status).toBe(401);

    const registrationB = await json("POST", "/auth/register", {
      invitationToken: invitationB,
      email: emailB,
      password,
      displayName: "P9 User B",
    });
    expect(registrationB.status).toBe(201);
    const accessB = String(required(required(registrationB.body).session).accessToken);
    expect((await get(`/devices/${deviceId}`, accessB)).status).toBe(404);
    expect((await get(`/settings/devices/${deviceId}`, accessB)).status).toBe(404);
    expect((await get(`/pairing/${secondPairingId}`, accessB)).status).toBe(404);
    expect((await json("POST", "/auth/logout-all", {}, accessB)).status).toBe(204);
    expect((await get("/me", accessB)).status).toBe(401);

    const rateLimitedEmail = `p9-rate-${suffix}@example.com`;
    const rateResults: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      rateResults.push((await json("POST", "/auth/login", { email: rateLimitedEmail, password: "wrong-password" })).status);
    }
    expect(rateResults.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(rateResults[5]).toBe(429);
    expect((await get("/me", "not-a-jwt")).status).toBe(401);
    expect((await json("POST", "/auth/login", { email: "' OR 1=1 --", password: "wrong-password" })).status).toBe(401);
  });
});

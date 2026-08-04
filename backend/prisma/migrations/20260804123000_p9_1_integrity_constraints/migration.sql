-- P9.1 review fix: enforce application invariants at the PostgreSQL boundary.

CREATE UNIQUE INDEX "Session_familyId_key" ON "Session"("familyId");
CREATE UNIQUE INDEX "Session_id_familyId_key" ON "Session"("id", "familyId");
CREATE UNIQUE INDEX "Device_id_userId_key" ON "Device"("id", "userId");

ALTER TABLE "RefreshToken" DROP CONSTRAINT "RefreshToken_sessionId_fkey";
ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_session_family_fkey"
  FOREIGN KEY ("sessionId", "familyId")
  REFERENCES "Session"("id", "familyId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DevicePairing" DROP CONSTRAINT "DevicePairing_deviceId_fkey";
ALTER TABLE "DevicePairing"
  ADD CONSTRAINT "DevicePairing_device_owner_fkey"
  FOREIGN KEY ("deviceId", "userId")
  REFERENCES "Device"("id", "userId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_client_device_owner_fkey"
  FOREIGN KEY ("clientDeviceId", "userId")
  REFERENCES "Device"("id", "userId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "User"
  ADD CONSTRAINT "User_email_normalized_ck"
  CHECK ("email" = lower(btrim("email")));

ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_email_normalized_ck"
  CHECK ("email" = lower(btrim("email")));

ALTER TABLE "PasswordCredential"
  ADD CONSTRAINT "PasswordCredential_argon2id_ck"
  CHECK ("algorithm" = 'argon2id' AND "passwordHash" LIKE '$argon2id$%');

ALTER TABLE "DevicePairing"
  ADD CONSTRAINT "DevicePairing_attempt_bounds_ck"
  CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0 AND "attemptCount" <= "maxAttempts");

ALTER TABLE "UserSettings"
  ADD CONSTRAINT "UserSettings_timezone_ck"
  CHECK ("timezone" = 'Asia/Jakarta');

ALTER TABLE "DeviceSettings"
  ADD CONSTRAINT "DeviceSettings_voice_bounds_ck"
  CHECK (
    "playbackVolume" BETWEEN 0 AND 100
    AND "speechSpeed" BETWEEN 0.85 AND 1.15
    AND "voiceProfileId" = 'prudence'
  );

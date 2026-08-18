CREATE TYPE "HardwareEnrollmentStatus" AS ENUM ('ISSUED', 'CLAIMED', 'EXPIRED', 'REVOKED', 'INVALIDATED');

CREATE TABLE "HardwareEnrollment" (
    "id" UUID NOT NULL,
    "hardwareId" VARCHAR(128) NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "status" "HardwareEnrollmentStatus" NOT NULL DEFAULT 'ISSUED',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "claimedAt" TIMESTAMPTZ(3),
    "claimedUserId" UUID,
    "claimedDeviceId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "HardwareEnrollment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "HardwareEnrollment"
  ADD CONSTRAINT "HardwareEnrollment_claimedUser_fkey"
  FOREIGN KEY ("claimedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HardwareEnrollment"
  ADD CONSTRAINT "HardwareEnrollment_claimedDevice_fkey"
  FOREIGN KEY ("claimedDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "HardwareEnrollment_hardwareId_status_expiresAt_idx"
  ON "HardwareEnrollment"("hardwareId", "status", "expiresAt");

CREATE INDEX "HardwareEnrollment_codeHash_status_idx"
  ON "HardwareEnrollment"("codeHash", "status");

CREATE INDEX "HardwareEnrollment_claimedUserId_createdAt_idx"
  ON "HardwareEnrollment"("claimedUserId", "createdAt");

DROP INDEX "Device_hardwareId_key";

CREATE UNIQUE INDEX "Device_active_hardware_key"
  ON "Device"("hardwareId")
  WHERE "status" IN ('PENDING', 'ACTIVE');

CREATE UNIQUE INDEX "HardwareEnrollment_active_hardware_key"
  ON "HardwareEnrollment"("hardwareId")
  WHERE "status" = 'ISSUED';

CREATE UNIQUE INDEX "HardwareEnrollment_active_code_key"
  ON "HardwareEnrollment"("codeHash")
  WHERE "status" = 'ISSUED';

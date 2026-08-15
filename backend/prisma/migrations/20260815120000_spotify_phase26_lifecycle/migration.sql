ALTER TYPE "IntegrationStatus" ADD VALUE IF NOT EXISTS 'RECONNECT_REQUIRED';

ALTER TABLE "SpotifyCredential"
  ADD COLUMN "spotifyUserId" VARCHAR(255),
  ADD COLUMN "authorizedAt" TIMESTAMPTZ(3),
  ADD COLUMN "market" VARCHAR(2),
  ADD COLUMN "preferredDeviceId" VARCHAR(255);

UPDATE "SpotifyCredential"
SET "authorizedAt" = "createdAt"
WHERE "authorizedAt" IS NULL;

ALTER TABLE "SpotifyCredential"
  ALTER COLUMN "authorizedAt" SET NOT NULL;

ALTER TABLE "SpotifyCredential"
  ADD CONSTRAINT "SpotifyCredential_market_ck"
  CHECK ("market" IS NULL OR "market" ~ '^[A-Z]{2}$');

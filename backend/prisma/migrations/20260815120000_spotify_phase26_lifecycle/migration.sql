ALTER TYPE "IntegrationStatus" ADD VALUE IF NOT EXISTS 'RECONNECT_REQUIRED';

ALTER TABLE "SpotifyCredential"
  ADD COLUMN "spotifyAccountId" VARCHAR(255),
  ADD COLUMN "spotifyProfileId" VARCHAR(255),
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

CREATE UNIQUE INDEX "SpotifyCredential_spotifyAccountId_key"
  ON "SpotifyCredential"("spotifyAccountId");

ALTER TABLE "SpotifyCredential"
  ADD CONSTRAINT "SpotifyCredential_spotifyAccountId_ck"
  CHECK ("spotifyAccountId" IS NULL OR length(btrim("spotifyAccountId")) > 0);

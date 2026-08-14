-- Additive candidate WhatsApp conversation/contact index.
CREATE TYPE "WhatsAppConversationType" AS ENUM ('DM', 'GROUP');

CREATE TABLE "WhatsAppConversation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'WHATSAPP',
    "opaqueChatRef" VARCHAR(255) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "type" "WhatsAppConversationType" NOT NULL,
    "lastActivityAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WhatsAppSendRequest" ADD COLUMN "conversationId" UUID;
ALTER TABLE "WhatsAppDelivery" ADD COLUMN "conversationId" UUID;

CREATE UNIQUE INDEX "WhatsAppConversation_id_userId_provider_key"
  ON "WhatsAppConversation"("id", "userId", "provider");
CREATE UNIQUE INDEX "WhatsAppConversation_owner_chat_key"
  ON "WhatsAppConversation"("userId", "connectionId", "provider", "opaqueChatRef");
CREATE INDEX "WhatsAppConversation_userId_lastActivityAt_id_idx"
  ON "WhatsAppConversation"("userId", "lastActivityAt" DESC, "id");
CREATE INDEX "WhatsAppSendRequest_conversationId_idx"
  ON "WhatsAppSendRequest"("conversationId");
CREATE INDEX "WhatsAppDelivery_conversationId_createdAt_idx"
  ON "WhatsAppDelivery"("conversationId", "createdAt");

ALTER TABLE "WhatsAppConversation"
  ADD CONSTRAINT "WhatsAppConversation_provider_ck"
  CHECK ("provider" = 'WHATSAPP');

ALTER TABLE "WhatsAppConversation"
  ADD CONSTRAINT "WhatsAppConversation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppConversation_connection_owner_provider_fkey"
  FOREIGN KEY ("connectionId", "userId", "provider")
  REFERENCES "IntegrationConnection"("id", "userId", "provider")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppSendRequest"
  ADD CONSTRAINT "WhatsAppSendRequest_conversation_owner_provider_fkey"
  FOREIGN KEY ("conversationId", "userId", "provider")
  REFERENCES "WhatsAppConversation"("id", "userId", "provider")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WhatsAppDelivery"
  ADD CONSTRAINT "WhatsAppDelivery_conversation_owner_provider_fkey"
  FOREIGN KEY ("conversationId", "userId", "provider")
  REFERENCES "WhatsAppConversation"("id", "userId", "provider")
  ON DELETE RESTRICT ON UPDATE CASCADE;

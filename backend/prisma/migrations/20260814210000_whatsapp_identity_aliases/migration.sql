-- Additive WhatsApp provider-identity aliases for LID/phone-JID reconciliation.
CREATE TABLE "WhatsAppConversationAlias" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'WHATSAPP',
    "conversationId" UUID NOT NULL,
    "providerRef" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsAppConversationAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppConversation_id_userId_connectionId_provider_key"
  ON "WhatsAppConversation"("id", "userId", "connectionId", "provider");
CREATE UNIQUE INDEX "WhatsAppConversationAlias_owner_provider_ref_key"
  ON "WhatsAppConversationAlias"("userId", "connectionId", "provider", "providerRef");
CREATE INDEX "WhatsAppConversationAlias_conversation_idx"
  ON "WhatsAppConversationAlias"("conversationId", "userId", "connectionId", "provider");

ALTER TABLE "WhatsAppConversationAlias"
  ADD CONSTRAINT "WhatsAppConversationAlias_provider_ck"
  CHECK ("provider" = 'WHATSAPP');

INSERT INTO "WhatsAppConversationAlias" (
  "id", "userId", "connectionId", "provider", "conversationId", "providerRef", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), c."userId", c."connectionId", c."provider", c."id", c."opaqueChatRef", clock_timestamp(), clock_timestamp()
FROM "WhatsAppConversation" c;

ALTER TABLE "WhatsAppConversationAlias"
  ADD CONSTRAINT "WhatsAppConversationAlias_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppConversationAlias_connection_owner_provider_fkey"
  FOREIGN KEY ("connectionId", "userId", "provider")
  REFERENCES "IntegrationConnection"("id", "userId", "provider")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppConversationAlias_conversation_owner_provider_fkey"
  FOREIGN KEY ("conversationId", "userId", "connectionId", "provider")
  REFERENCES "WhatsAppConversation"("id", "userId", "connectionId", "provider")
  ON DELETE CASCADE ON UPDATE CASCADE;

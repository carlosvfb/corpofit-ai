-- Verificação de e-mail, convites pendentes e notificações.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emailVerifiedFor" TEXT;

-- CreateTable
CREATE TABLE "EmailVerification" (
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PendingInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingInvite_email_tenantId_key" ON "PendingInvite"("email", "tenantId");
CREATE INDEX "PendingInvite_tenantId_idx" ON "PendingInvite"("tenantId");
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- Row Level Security
ALTER TABLE "EmailVerification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailVerification" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_row ON "EmailVerification" FOR ALL
  USING ("userId" = current_setting('app.user_id', true)) WITH CHECK ("userId" = current_setting('app.user_id', true));

-- A academia vê e cria os convites dela; `app.claim_email` (só o servidor, depois de o e-mail ser confirmado) lê e apaga os do próprio e-mail.
ALTER TABLE "PendingInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PendingInvite" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_claim ON "PendingInvite" FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true) OR "email" = current_setting('app.claim_email', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Cada pessoa lê e marca como lida só as próprias; qualquer contexto autenticado pode criar o aviso de outra pessoa
-- (o servidor decide quando). Sem DELETE.
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_read ON "Notification" FOR SELECT USING ("userId" = current_setting('app.user_id', true));
CREATE POLICY own_update ON "Notification" FOR UPDATE USING ("userId" = current_setting('app.user_id', true)) WITH CHECK ("userId" = current_setting('app.user_id', true));
CREATE POLICY any_insert ON "Notification" FOR INSERT WITH CHECK (coalesce(current_setting('app.user_id', true), '') <> '');
CREATE POLICY erase_notif ON "Notification" FOR DELETE USING ("userId" = current_setting('app.eraser', true));

-- O painel da plataforma (admin) lê as academias e os vínculos só para CONTAR (app.moderator = 'platform', definido pelo servidor depois de verificar o admin).
CREATE POLICY platform_read ON "Tenant" FOR SELECT USING (current_setting('app.moderator', true) = 'platform');
CREATE POLICY platform_read ON "Membership" FOR SELECT USING (current_setting('app.moderator', true) = 'platform');

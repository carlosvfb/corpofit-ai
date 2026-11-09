-- Biblioteca comunitária: itens, favoritos e denúncias, com RLS.

-- CreateEnum
CREATE TYPE "CommunityKind" AS ENUM ('ROUTINE', 'PLAN', 'TIP', 'ARTICLE');
CREATE TYPE "CommunityVisibility" AS ENUM ('PUBLIC', 'GYM');
CREATE TYPE "CommunityStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'REMOVED');
CREATE TYPE "ReportReason" AS ENUM ('INAPPROPRIATE', 'COPYRIGHT', 'PERSONAL_DATA', 'SPAM', 'OTHER');

-- CreateTable
CREATE TABLE "CommunityItem" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "tenantId" TEXT,
    "kind" "CommunityKind" NOT NULL,
    "visibility" "CommunityVisibility" NOT NULL DEFAULT 'PUBLIC',
    "status" "CommunityStatus" NOT NULL DEFAULT 'PUBLISHED',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "bundle" JSONB,
    "rightsConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "imports" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityFavorite" (
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityFavorite_pkey" PRIMARY KEY ("userId", "itemId")
);

-- CreateTable
CREATE TABLE "CommunityReport" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "decision" TEXT,
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunityItem_visibility_status_createdAt_idx" ON "CommunityItem"("visibility", "status", "createdAt");
CREATE INDEX "CommunityItem_tenantId_status_createdAt_idx" ON "CommunityItem"("tenantId", "status", "createdAt");
CREATE INDEX "CommunityItem_authorId_idx" ON "CommunityItem"("authorId");
CREATE UNIQUE INDEX "CommunityReport_itemId_reporterId_key" ON "CommunityReport"("itemId", "reporterId");
CREATE INDEX "CommunityReport_status_createdAt_idx" ON "CommunityReport"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CommunityFavorite" ADD CONSTRAINT "CommunityFavorite_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CommunityItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CommunityItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security. A API define `app.user_id` e, só depois de verificar o papel, `app.moderator`
-- ('platform' ou 'tenant:<id>'). Lê-se: o publicado e público, o publicado da própria academia, o que se é
-- autor, e (moderador) o que ele modera. Altera-se: só o próprio item, ou o que se modera.
ALTER TABLE "CommunityItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommunityItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY item_read ON "CommunityItem" FOR SELECT USING (
  "authorId" = current_setting('app.user_id', true)
  OR ("status" = 'PUBLISHED' AND "visibility" = 'PUBLIC' AND coalesce(current_setting('app.user_id', true), '') <> '')
  OR ("status" = 'PUBLISHED' AND "visibility" = 'GYM' AND "tenantId" IN (SELECT "tenantId" FROM "Membership" WHERE "userId" = current_setting('app.user_id', true) AND "status" = 'ACTIVE'))
  OR current_setting('app.moderator', true) = 'platform'
  OR ("tenantId" IS NOT NULL AND current_setting('app.moderator', true) = 'tenant:' || "tenantId")
);
CREATE POLICY item_insert ON "CommunityItem" FOR INSERT WITH CHECK ("authorId" = current_setting('app.user_id', true));
-- `app.counter` = id de UM item: o servidor o define só para contar uma importação, depois de checar a visibilidade.
CREATE POLICY item_update ON "CommunityItem" FOR UPDATE USING (
  "authorId" = current_setting('app.user_id', true)
  OR "id" = current_setting('app.counter', true)
  OR current_setting('app.moderator', true) = 'platform'
  OR ("tenantId" IS NOT NULL AND current_setting('app.moderator', true) = 'tenant:' || "tenantId")
) WITH CHECK (
  "authorId" = current_setting('app.user_id', true)
  OR "id" = current_setting('app.counter', true)
  OR current_setting('app.moderator', true) = 'platform'
  OR ("tenantId" IS NOT NULL AND current_setting('app.moderator', true) = 'tenant:' || "tenantId")
);

ALTER TABLE "CommunityFavorite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommunityFavorite" FORCE ROW LEVEL SECURITY;
CREATE POLICY fav_own ON "CommunityFavorite" FOR ALL
  USING ("userId" = current_setting('app.user_id', true)) WITH CHECK ("userId" = current_setting('app.user_id', true));

ALTER TABLE "CommunityReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommunityReport" FORCE ROW LEVEL SECURITY;
CREATE POLICY report_insert ON "CommunityReport" FOR INSERT WITH CHECK ("reporterId" = current_setting('app.user_id', true));
CREATE POLICY report_read ON "CommunityReport" FOR SELECT USING (
  "reporterId" = current_setting('app.user_id', true)
  OR current_setting('app.moderator', true) = 'platform'
  OR "itemId" IN (SELECT "id" FROM "CommunityItem" WHERE "tenantId" IS NOT NULL AND current_setting('app.moderator', true) = 'tenant:' || "tenantId")
);
CREATE POLICY report_update ON "CommunityReport" FOR UPDATE USING (
  current_setting('app.moderator', true) = 'platform'
  OR "itemId" IN (SELECT "id" FROM "CommunityItem" WHERE "tenantId" IS NOT NULL AND current_setting('app.moderator', true) = 'tenant:' || "tenantId")
) WITH CHECK (true);

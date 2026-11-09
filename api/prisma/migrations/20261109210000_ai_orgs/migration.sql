-- IA por academia: contexto escolhido pelo usuário e consumo por academia, com custo estimado.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "aiTenantId" TEXT;

-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "UsageRecord" ADD COLUMN "provider" TEXT;
ALTER TABLE "UsageRecord" ADD COLUMN "costMicros" INTEGER;

-- CreateIndex
CREATE INDEX "UsageRecord_tenantId_createdAt_idx" ON "UsageRecord"("tenantId", "createdAt");

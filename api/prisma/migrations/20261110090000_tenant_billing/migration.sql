-- Assinaturas de academia: a mesma tabela de assinaturas, com o tenant que ela paga e o código do plano da academia.

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "tenantPlan" TEXT;

-- CreateIndex
CREATE INDEX "Subscription_tenantId_idx" ON "Subscription"("tenantId");

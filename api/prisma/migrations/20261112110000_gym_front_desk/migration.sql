-- Recepção da academia: cadastro completo do aluno, planos e mensalidades, aparelhos numerados e controle de acesso.
-- Tudo pertence a UMA academia (tenantId) e usa o mesmo RLS das outras tabelas da academia: sem `app.tenant_id`
-- a consulta não enxerga nada. O aluno lê o PRÓPRIO cadastro e as PRÓPRIAS mensalidades (política *_self).
-- Biometria facial: só existe a FOTO de cadastro, guardada à parte, e só com consentimento específico registrado aqui.

ALTER TABLE "PendingInvite" ADD COLUMN "autoAccept" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "GymStudentStatus" AS ENUM ('ENROLLED', 'ACTIVE', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "GymChargeStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');
CREATE TYPE "GymEquipmentStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'RETIRED');

CREATE TABLE "GymPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GymPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GymStudent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "number" INTEGER NOT NULL,
    "accessCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "document" TEXT NOT NULL DEFAULT '',
    "birthDate" DATE,
    "address" TEXT NOT NULL DEFAULT '',
    "emergencyName" TEXT NOT NULL DEFAULT '',
    "emergencyPhone" TEXT NOT NULL DEFAULT '',
    "healthNotes" TEXT NOT NULL DEFAULT '',
    "guardianName" TEXT NOT NULL DEFAULT '',
    "guardianDocument" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "GymStudentStatus" NOT NULL DEFAULT 'ENROLLED',
    "planId" TEXT,
    "billingDay" INTEGER NOT NULL DEFAULT 10,
    "graceDays" INTEGER NOT NULL DEFAULT 3,
    "termsAcceptedAt" TIMESTAMP(3),
    "trainingConsentAt" TIMESTAMP(3),
    "faceConsentAt" TIMESTAMP(3),
    "faceConsentBy" TEXT,
    "hasFacePhoto" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GymStudent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GymCharge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "planId" TEXT,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "GymChargeStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "method" TEXT,
    "recordedById" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GymCharge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GymEquipment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "muscles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exerciseIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "location" TEXT NOT NULL DEFAULT '',
    "status" "GymEquipmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GymEquipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GymDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GymDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GymAccessEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT,
    "deviceId" TEXT,
    "method" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'IN',
    "allowed" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GymAccessEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GymStudent_tenantId_number_key" ON "GymStudent"("tenantId", "number");
CREATE UNIQUE INDEX "GymStudent_accessCode_key" ON "GymStudent"("accessCode");
CREATE UNIQUE INDEX "GymStudent_tenantId_email_key" ON "GymStudent"("tenantId", "email");
CREATE INDEX "GymStudent_userId_idx" ON "GymStudent"("userId");
CREATE INDEX "GymStudent_tenantId_status_idx" ON "GymStudent"("tenantId", "status");
CREATE INDEX "GymPlan_tenantId_idx" ON "GymPlan"("tenantId");
CREATE UNIQUE INDEX "GymCharge_studentId_reference_key" ON "GymCharge"("studentId", "reference");
CREATE INDEX "GymCharge_tenantId_status_dueDate_idx" ON "GymCharge"("tenantId", "status", "dueDate");
CREATE UNIQUE INDEX "GymEquipment_tenantId_number_key" ON "GymEquipment"("tenantId", "number");
CREATE UNIQUE INDEX "GymDevice_tokenHash_key" ON "GymDevice"("tokenHash");
CREATE INDEX "GymDevice_tenantId_idx" ON "GymDevice"("tenantId");
CREATE INDEX "GymAccessEvent_tenantId_createdAt_idx" ON "GymAccessEvent"("tenantId", "createdAt");

ALTER TABLE "GymPlan" ADD CONSTRAINT "GymPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GymStudent" ADD CONSTRAINT "GymStudent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GymStudent" ADD CONSTRAINT "GymStudent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "GymPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GymCharge" ADD CONSTRAINT "GymCharge_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "GymStudent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GymCharge" ADD CONSTRAINT "GymCharge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GymEquipment" ADD CONSTRAINT "GymEquipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GymDevice" ADD CONSTRAINT "GymDevice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GymAccessEvent" ADD CONSTRAINT "GymAccessEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security: a academia em uso. A API confere o papel (recepção, gerente, admin...) em cada operação.
ALTER TABLE "GymPlan" ENABLE ROW LEVEL SECURITY;      ALTER TABLE "GymPlan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GymStudent" ENABLE ROW LEVEL SECURITY;   ALTER TABLE "GymStudent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GymCharge" ENABLE ROW LEVEL SECURITY;    ALTER TABLE "GymCharge" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GymEquipment" ENABLE ROW LEVEL SECURITY; ALTER TABLE "GymEquipment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GymDevice" ENABLE ROW LEVEL SECURITY;    ALTER TABLE "GymDevice" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GymAccessEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "GymAccessEvent" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON "GymPlan" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY tenant_scope ON "GymStudent" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY tenant_scope ON "GymCharge" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY tenant_scope ON "GymEquipment" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY tenant_scope ON "GymDevice" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY tenant_scope ON "GymAccessEvent" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- O aluno lê o próprio cadastro e as próprias mensalidades, e quem é membro ativo lê o plano e os aparelhos da sua academia.
CREATE POLICY student_self ON "GymStudent" FOR SELECT USING ("userId" = current_setting('app.user_id', true));
CREATE POLICY student_self ON "GymCharge" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "GymStudent" s WHERE s."id" = "GymCharge"."studentId" AND s."userId" = current_setting('app.user_id', true)));
CREATE POLICY member_read ON "GymEquipment" FOR SELECT
  USING ("tenantId" IN (SELECT "tenantId" FROM "Membership" WHERE "userId" = current_setting('app.user_id', true) AND "status" = 'ACTIVE'));
CREATE POLICY member_read ON "GymPlan" FOR SELECT
  USING ("tenantId" IN (SELECT "tenantId" FROM "Membership" WHERE "userId" = current_setting('app.user_id', true) AND "status" = 'ACTIVE'));

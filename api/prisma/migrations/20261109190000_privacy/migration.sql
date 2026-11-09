-- Privacidade e compartilhamento: permissões por categoria, histórico de consentimento e registro de acessos.

-- CreateEnum
CREATE TYPE "ShareCategory" AS ENUM ('WORKOUTS', 'ROUTINES', 'EXERCISE_HISTORY', 'BODY_WEIGHT', 'MEASUREMENTS', 'PHOTOS', 'NOTES', 'ACTIVITY', 'WELLBEING');

-- CreateEnum
CREATE TYPE "ShareLevel" AS ENUM ('OFF', 'SEE', 'SUGGEST', 'CHANGE_DIRECTLY');

-- AlterTable: o treino enviado pode ser uma sugestão para uma rotina do aluno
ALTER TABLE "Assignment" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'ASSIGNMENT';
ALTER TABLE "Assignment" ADD COLUMN "target" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "SharingPermission" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "category" "ShareCategory" NOT NULL,
    "level" "ShareLevel" NOT NULL DEFAULT 'OFF',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharingPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "category" "ShareCategory" NOT NULL,
    "previousLevel" "ShareLevel" NOT NULL,
    "level" "ShareLevel" NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "category" "ShareCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharingPermission_studentId_trainerId_category_key" ON "SharingPermission"("studentId", "trainerId", "category");

-- CreateIndex
CREATE INDEX "SharingPermission_trainerId_idx" ON "SharingPermission"("trainerId");

-- CreateIndex
CREATE INDEX "ConsentRecord_studentId_createdAt_idx" ON "ConsentRecord"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "AccessLog_studentId_createdAt_idx" ON "AccessLog"("studentId", "createdAt");

-- Row Level Security. Só o aluno concede e altera; o personal só lê o que foi concedido a ele.
ALTER TABLE "SharingPermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SharingPermission" FORCE ROW LEVEL SECURITY;
CREATE POLICY student_all ON "SharingPermission" FOR ALL
  USING ("studentId" = current_setting('app.user_id', true))
  WITH CHECK ("studentId" = current_setting('app.user_id', true));
CREATE POLICY trainer_read ON "SharingPermission" FOR SELECT
  USING ("trainerId" = current_setting('app.user_id', true));

-- O histórico é do aluno; ninguém altera nem apaga linhas (sem políticas de UPDATE/DELETE).
ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsentRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY student_read ON "ConsentRecord" FOR SELECT USING ("studentId" = current_setting('app.user_id', true));
CREATE POLICY student_insert ON "ConsentRecord" FOR INSERT WITH CHECK ("studentId" = current_setting('app.user_id', true) AND "actorUserId" = current_setting('app.user_id', true));

-- O aluno lê o registro dos acessos aos seus dados; o personal só registra os próprios acessos.
ALTER TABLE "AccessLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccessLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY student_read ON "AccessLog" FOR SELECT USING ("studentId" = current_setting('app.user_id', true));
CREATE POLICY actor_insert ON "AccessLog" FOR INSERT WITH CHECK ("actorId" = current_setting('app.user_id', true));

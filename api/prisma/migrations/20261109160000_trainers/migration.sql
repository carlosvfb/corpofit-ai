-- Personal trainers: perfil, vínculo com alunos, treinos enviados e comentários, com RLS por usuário.

-- CreateEnum
CREATE TYPE "TrainerLinkStatus" AS ENUM ('PENDING', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "LinkInitiator" AS ENUM ('TRAINER', 'STUDENT');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'IMPORTED', 'DECLINED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "TrainerProfile" (
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "specialties" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainerProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TrainerStudent" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tenantId" TEXT,
    "status" "TrainerLinkStatus" NOT NULL DEFAULT 'PENDING',
    "initiatedBy" "LinkInitiator" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "TrainerStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "bundle" JSONB NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentComment" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainerStudent_studentId_idx" ON "TrainerStudent"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerStudent_trainerId_studentId_key" ON "TrainerStudent"("trainerId", "studentId");

-- CreateIndex
CREATE INDEX "Assignment_studentId_createdAt_idx" ON "Assignment"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "Assignment_trainerId_createdAt_idx" ON "Assignment"("trainerId", "createdAt");

-- CreateIndex
CREATE INDEX "AssignmentComment_assignmentId_createdAt_idx" ON "AssignmentComment"("assignmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "TrainerProfile" ADD CONSTRAINT "TrainerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerStudent" ADD CONSTRAINT "TrainerStudent_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerStudent" ADD CONSTRAINT "TrainerStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "TrainerStudent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentComment" ADD CONSTRAINT "AssignmentComment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security: só os dois lados de um vínculo enxergam o vínculo e o que ele contém.
ALTER TABLE "TrainerStudent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainerStudent" FORCE ROW LEVEL SECURITY;
CREATE POLICY pair_scope ON "TrainerStudent"
  USING ("trainerId" = current_setting('app.user_id', true) OR "studentId" = current_setting('app.user_id', true))
  WITH CHECK ("trainerId" = current_setting('app.user_id', true) OR "studentId" = current_setting('app.user_id', true));

ALTER TABLE "Assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Assignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY pair_scope ON "Assignment"
  USING ("trainerId" = current_setting('app.user_id', true) OR "studentId" = current_setting('app.user_id', true))
  WITH CHECK ("trainerId" = current_setting('app.user_id', true) OR "studentId" = current_setting('app.user_id', true));

ALTER TABLE "AssignmentComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssignmentComment" FORCE ROW LEVEL SECURITY;
CREATE POLICY pair_scope ON "AssignmentComment"
  USING ("assignmentId" IN (SELECT "id" FROM "Assignment"))
  WITH CHECK ("assignmentId" IN (SELECT "id" FROM "Assignment") AND "authorId" = current_setting('app.user_id', true));

-- O perfil profissional é um cartão público entre usuários autenticados (nome, bio, especialidades);
-- só o próprio personal o altera.
ALTER TABLE "TrainerProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainerProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY card_read ON "TrainerProfile" FOR SELECT
  USING (coalesce(current_setting('app.user_id', true), '') <> '');
CREATE POLICY card_write ON "TrainerProfile" FOR ALL
  USING ("userId" = current_setting('app.user_id', true))
  WITH CHECK ("userId" = current_setting('app.user_id', true));

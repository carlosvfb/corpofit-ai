-- Agenda de treinos e anotações privadas do personal.

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'DONE', 'MISSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "place" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "status" "SessionStatus" NOT NULL DEFAULT 'PLANNED',
    "cancelledBy" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "seriesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerNote" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingSession_trainerId_startsAt_idx" ON "TrainingSession"("trainerId", "startsAt");
CREATE INDEX "TrainingSession_studentId_startsAt_idx" ON "TrainingSession"("studentId", "startsAt");
CREATE INDEX "TrainerNote_linkId_createdAt_idx" ON "TrainerNote"("linkId", "createdAt");

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "TrainerStudent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainerNote" ADD CONSTRAINT "TrainerNote_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "TrainerStudent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security: a agenda é das duas partes; as anotações, só do personal.
ALTER TABLE "TrainingSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY pair_scope ON "TrainingSession"
  USING ("trainerId" = current_setting('app.user_id', true) OR "studentId" = current_setting('app.user_id', true))
  WITH CHECK ("trainerId" = current_setting('app.user_id', true) OR "studentId" = current_setting('app.user_id', true));

ALTER TABLE "TrainerNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainerNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY trainer_only ON "TrainerNote" FOR ALL
  USING ("trainerId" = current_setting('app.user_id', true)) WITH CHECK ("trainerId" = current_setting('app.user_id', true));

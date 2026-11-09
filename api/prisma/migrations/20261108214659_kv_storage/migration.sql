-- CreateTable
CREATE TABLE "KvFile" (
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KvFile_pkey" PRIMARY KEY ("path")
);

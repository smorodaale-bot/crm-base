-- CreateEnum
CREATE TYPE "QcSourceType" AS ENUM ('TEXT', 'AUDIO');

-- CreateTable
CREATE TABLE "QcReview" (
    "id" SERIAL NOT NULL,
    "managerId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "clientName" TEXT,
    "sourceType" "QcSourceType" NOT NULL DEFAULT 'TEXT',
    "transcript" TEXT NOT NULL,
    "audioStoredName" TEXT,
    "audioOriginalName" TEXT,
    "overallScore" INTEGER NOT NULL,
    "manualScore" INTEGER,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "criterionScores" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "analyzerVersion" TEXT NOT NULL DEFAULT 'rules-v1',
    "supervisorComment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QcReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QcComment" (
    "id" SERIAL NOT NULL,
    "reviewId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QcComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QcReview_managerId_idx" ON "QcReview"("managerId");

-- CreateIndex
CREATE INDEX "QcReview_createdAt_idx" ON "QcReview"("createdAt");

-- CreateIndex
CREATE INDEX "QcReview_isCritical_idx" ON "QcReview"("isCritical");

-- CreateIndex
CREATE INDEX "QcReview_overallScore_idx" ON "QcReview"("overallScore");

-- CreateIndex
CREATE INDEX "QcComment_reviewId_idx" ON "QcComment"("reviewId");

-- AddForeignKey
ALTER TABLE "QcReview" ADD CONSTRAINT "QcReview_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcReview" ADD CONSTRAINT "QcReview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcComment" ADD CONSTRAINT "QcComment_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "QcReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcComment" ADD CONSTRAINT "QcComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

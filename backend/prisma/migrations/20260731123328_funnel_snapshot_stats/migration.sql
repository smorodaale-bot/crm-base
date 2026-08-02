-- CreateTable
CREATE TABLE "FunnelSnapshot" (
    "id" SERIAL NOT NULL,
    "day" DATE NOT NULL,
    "totalDeals" INTEGER NOT NULL,
    "openDeals" INTEGER NOT NULL,
    "openAmount" DOUBLE PRECISION NOT NULL,
    "needsWorkCount" INTEGER NOT NULL,
    "byStage" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunnelSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FunnelSnapshot_day_key" ON "FunnelSnapshot"("day");

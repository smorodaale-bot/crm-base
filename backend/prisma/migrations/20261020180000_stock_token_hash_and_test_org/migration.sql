ALTER TABLE "Organization" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Organization" SET "isTest" = true WHERE slug IN ('test-salon', 'demo-salon');

CREATE TABLE "StockSyncCredential" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StockSyncCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockSyncCredential_tokenHash_key" ON "StockSyncCredential"("tokenHash");
CREATE INDEX "StockSyncCredential_organizationId_idx" ON "StockSyncCredential"("organizationId");

ALTER TABLE "StockSyncCredential" ADD CONSTRAINT "StockSyncCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Organization" DROP COLUMN IF EXISTS "stockSyncToken";

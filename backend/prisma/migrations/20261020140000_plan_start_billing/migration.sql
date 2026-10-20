-- New entry plan. Existing rows stay on BASIC / ADVANCED / ULTRA.
ALTER TYPE "PlanTier" ADD VALUE 'START';

ALTER TABLE "Subscription" ADD COLUMN "billingInterval" TEXT NOT NULL DEFAULT 'month';
ALTER TABLE "Subscription" ADD COLUMN "promoMonthsUsed" INTEGER NOT NULL DEFAULT 0;

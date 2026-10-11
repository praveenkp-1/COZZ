-- Existing orders and payments are retained.
ALTER TYPE "PaymentStatus" ADD VALUE 'PENDING_COLLECTION';
ALTER TABLE "Order" ALTER COLUMN "expiresAt" DROP NOT NULL;
ALTER TABLE "Payment"
  ADD COLUMN "collectedAt" TIMESTAMP(3),
  ADD COLUMN "collectedById" TEXT;
CREATE INDEX "Payment_collectedById_idx" ON "Payment"("collectedById");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collectedById_fkey"
  FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cash_receipt" CHECK (
  ("collectedAt" IS NULL AND "collectedById" IS NULL) OR
  ("provider" = 'COD' AND "collectedAt" IS NOT NULL AND "collectedById" IS NOT NULL
    AND "status"::text IN ('PAID', 'REFUND_PENDING', 'REFUNDED'))
);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collected_cash" CHECK (
  "provider" <> 'COD' OR "status"::text NOT IN ('PAID', 'REFUND_PENDING', 'REFUNDED') OR
  ("collectedAt" IS NOT NULL AND "collectedById" IS NOT NULL)
);

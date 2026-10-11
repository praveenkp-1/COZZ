ALTER TABLE "EmailJob" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "NewsletterSubscription" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);
CREATE INDEX "Order_status_expiresAt_idx" ON "Order"("status", "expiresAt");

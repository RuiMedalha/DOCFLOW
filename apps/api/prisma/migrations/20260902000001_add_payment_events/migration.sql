CREATE TYPE "PaymentEventStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE');

CREATE TABLE "payment_events" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "status" "PaymentEventStatus" NOT NULL DEFAULT 'PENDING',
  "paidAt" TIMESTAMP(3),
  "paidAmount" DECIMAL(14,2),
  "paymentMethod" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_events_tenantId_documentId_key" ON "payment_events"("tenantId", "documentId");
CREATE INDEX "payment_events_tenantId_dueDate_idx" ON "payment_events"("tenantId", "dueDate");
CREATE INDEX "payment_events_tenantId_status_idx" ON "payment_events"("tenantId", "status");
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

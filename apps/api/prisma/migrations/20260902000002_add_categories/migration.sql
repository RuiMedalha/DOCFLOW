-- CreateTable
CREATE TABLE IF NOT EXISTS "categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT,
    "defaultIvaDeductibilityPct" INTEGER NOT NULL DEFAULT 100,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "categories_tenantId_slug_key" ON "categories"("tenantId", "slug");
CREATE INDEX IF NOT EXISTS "categories_tenantId_idx" ON "categories"("tenantId");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT IF NOT EXISTS "categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

-- AlterTable Document: add columns
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "expenseCategoryId" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "ivaDeductibilityPct" INTEGER;

-- AddForeignKey for documents.expenseCategoryId
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'documents_expenseCategoryId_fkey')
  THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL;
  END IF;
END $$;

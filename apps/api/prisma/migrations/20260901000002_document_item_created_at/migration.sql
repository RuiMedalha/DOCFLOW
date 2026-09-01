-- Supports deterministic oldest-first ordering in GET /documents/:id/items.
ALTER TABLE "document_items"
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

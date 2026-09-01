-- =============================================================================
-- Document.approval — approvedAt timestamp + approvedById (User)
-- =============================================================================
--
-- Powers POST /documents/:id/approve. When a document is approved we stamp
-- both the wall-clock time AND the approver so the audit trail can answer
-- "who approved this and when" without joining through AuditLog.
--
-- Both columns are NULLABLE on purpose:
--   - approvedAt NULL = never approved (the default for every existing row).
--   - approvedById NULL = same — populated atomically with approvedAt so the
--     two can never disagree.
-- A future "unapprove" route can simply clear both; today we only ever set.
--
-- No FK CASCADE on approvedBy → User: revoking a user must NOT erase the
-- approval stamp (audit immutability). RESTRICT (Prisma default) is correct.

ALTER TABLE "documents"
  ADD COLUMN "approvedAt"  TIMESTAMP(3),
  ADD COLUMN "approvedById" TEXT;

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lookup: "what did this approver sign off on, newest first?"
CREATE INDEX "documents_approvedById_idx"
  ON "documents"("approvedById");

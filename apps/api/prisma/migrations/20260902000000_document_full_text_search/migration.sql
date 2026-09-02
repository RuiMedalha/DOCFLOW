-- Full-text search vector is maintained by PostgreSQL for every Document write.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "documents"
  ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      concat_ws(
        ' ',
        "fileName",
        supplier,
        customer,
        "docNumber",
        "supplierNif",
        "customerNif",
        array_to_string(tags, ' ')
      )
    )
  ) STORED;

CREATE INDEX "documents_searchVector_gin_idx"
  ON "documents" USING GIN ("searchVector");

-- Stores why ingestion failed (e.g. "No extractable text (scanned PDF?)"), so the
-- dashboard can show a reason instead of a bare "failed". Nullable, so this is purely
-- additive: existing rows get NULL and no data changes.
ALTER TABLE "Document" ADD COLUMN "errorMessage" TEXT;

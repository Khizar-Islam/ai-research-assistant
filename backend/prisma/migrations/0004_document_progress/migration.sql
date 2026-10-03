-- Live ingestion progress for the dashboard: which pipeline stage a document is in, and
-- how many of its chunks are embedded so far. Purely additive: two nullable columns and
-- one with a default, so existing rows get NULL / 0 and no data changes.
ALTER TABLE "Document" ADD COLUMN "stage" TEXT;
ALTER TABLE "Document" ADD COLUMN "chunksTotal" INTEGER;
ALTER TABLE "Document" ADD COLUMN "chunksEmbedded" INTEGER NOT NULL DEFAULT 0;

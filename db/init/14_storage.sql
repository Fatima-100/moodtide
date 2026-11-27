/* =====================================================================
   MoodTide object storage support for creator uploads   (task A33)
   Location: db/init/14_storage.sql   (runs after 13_creators.sql)

   Adds 'uploading' status before the file is verified in R2 via
   POST /api/creator/uploads/:id/complete, plus content_type and size_bytes.

   Safe to run again. Run on EVERY database (local and Neon) before deploying.
   ===================================================================== */

ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_status_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_status_check
  CHECK (status IN ('uploading', 'pending', 'approved', 'rejected'));
ALTER TABLE uploads ALTER COLUMN status SET DEFAULT 'uploading';

ALTER TABLE uploads ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'audio/mpeg';
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes > 0);

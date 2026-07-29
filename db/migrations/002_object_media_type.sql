ALTER TABLE formweave_objects
  ADD COLUMN IF NOT EXISTS media_type text;

UPDATE formweave_objects AS object
SET media_type = blob.media_type
FROM formweave_blobs AS blob
WHERE blob.sha256 = object.blob_sha256
  AND object.media_type IS NULL;

ALTER TABLE formweave_objects
  ALTER COLUMN media_type SET NOT NULL;

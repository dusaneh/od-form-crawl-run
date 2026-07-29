CREATE TABLE IF NOT EXISTS formweave_settings (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS formweave_runs (
  id text PRIMARY KEY,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS formweave_runs_created_at_idx
  ON formweave_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS formweave_reports (
  run_id text PRIMARY KEY REFERENCES formweave_runs(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  sha256 character(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS formweave_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope_type text NOT NULL CHECK (scope_type IN ('run', 'execution', 'system')),
  scope_id text NOT NULL,
  event_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  kind text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL,
  UNIQUE (scope_type, scope_id, event_key)
);

CREATE INDEX IF NOT EXISTS formweave_events_scope_idx
  ON formweave_events (scope_type, scope_id, id);

CREATE TABLE IF NOT EXISTS formweave_script_artifacts (
  artifact_id text PRIMARY KEY,
  initial_url text,
  latest_version integer NOT NULL DEFAULT 0 CHECK (latest_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS formweave_script_versions (
  artifact_id text NOT NULL REFERENCES formweave_script_artifacts(artifact_id),
  version integer NOT NULL CHECK (version > 0),
  source_sha256 character(64) NOT NULL,
  plan_sha256 character(64) NOT NULL,
  plan jsonb NOT NULL,
  manifest jsonb NOT NULL,
  source_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artifact_id, version),
  UNIQUE (artifact_id, source_sha256),
  UNIQUE (artifact_id, version, source_sha256),
  CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (plan_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS formweave_forms (
  id text PRIMARY KEY,
  source_run_id text REFERENCES formweave_runs(id) ON DELETE SET NULL,
  artifact_id text,
  script_version integer,
  source_sha256 character(64),
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  FOREIGN KEY (artifact_id, script_version, source_sha256)
    REFERENCES formweave_script_versions(
      artifact_id, version, source_sha256
    )
);

CREATE INDEX IF NOT EXISTS formweave_forms_created_at_idx
  ON formweave_forms (created_at DESC);

CREATE TABLE IF NOT EXISTS formweave_form_approvals (
  approval_id text PRIMARY KEY,
  form_id text NOT NULL REFERENCES formweave_forms(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  artifact_id text NOT NULL,
  script_version integer NOT NULL,
  source_sha256 character(64) NOT NULL,
  decided_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  FOREIGN KEY (artifact_id, script_version, source_sha256)
    REFERENCES formweave_script_versions(
      artifact_id, version, source_sha256
    )
);

CREATE TABLE IF NOT EXISTS formweave_executions (
  id text PRIMARY KEY,
  form_id text REFERENCES formweave_forms(id) ON DELETE SET NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS formweave_executions_created_at_idx
  ON formweave_executions (created_at DESC);

CREATE TABLE IF NOT EXISTS formweave_lineages (
  lineage_key text PRIMARY KEY,
  normalized_url text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS formweave_blobs (
  sha256 character(64) PRIMARY KEY,
  media_type text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(bytes) = byte_length),
  CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS formweave_objects (
  owner_type text NOT NULL CHECK (
    owner_type IN ('run', 'script', 'form', 'execution', 'system')
  ),
  owner_id text NOT NULL,
  object_key text NOT NULL,
  object_kind text NOT NULL,
  media_type text NOT NULL,
  blob_sha256 character(64) NOT NULL REFERENCES formweave_blobs(sha256),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_type, owner_id, object_key)
);

CREATE INDEX IF NOT EXISTS formweave_objects_blob_idx
  ON formweave_objects (blob_sha256);

CREATE OR REPLACE FUNCTION formweave_reject_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS formweave_script_versions_immutable
  ON formweave_script_versions;
CREATE TRIGGER formweave_script_versions_immutable
BEFORE UPDATE OR DELETE ON formweave_script_versions
FOR EACH ROW EXECUTE FUNCTION formweave_reject_immutable_change();

DROP TRIGGER IF EXISTS formweave_approvals_immutable
  ON formweave_form_approvals;
CREATE TRIGGER formweave_approvals_immutable
BEFORE UPDATE OR DELETE ON formweave_form_approvals
FOR EACH ROW EXECUTE FUNCTION formweave_reject_immutable_change();

DROP TRIGGER IF EXISTS formweave_events_immutable
  ON formweave_events;
CREATE TRIGGER formweave_events_immutable
BEFORE UPDATE OR DELETE ON formweave_events
FOR EACH ROW EXECUTE FUNCTION formweave_reject_immutable_change();

DROP TRIGGER IF EXISTS formweave_blobs_immutable
  ON formweave_blobs;
CREATE TRIGGER formweave_blobs_immutable
BEFORE UPDATE OR DELETE ON formweave_blobs
FOR EACH ROW EXECUTE FUNCTION formweave_reject_immutable_change();

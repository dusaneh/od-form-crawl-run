CREATE TABLE IF NOT EXISTS formweave_semantic_candidates (
  candidate_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  candidate_version integer NOT NULL CHECK (candidate_version > 0),
  candidate_sha256 character(64) NOT NULL,
  observation_sha256 character(64) NOT NULL,
  parent_candidate_id text REFERENCES formweave_semantic_candidates(candidate_id),
  status text NOT NULL CHECK (
    status IN ('draft', 'rejected', 'validated', 'superseded')
  ),
  proposal jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, candidate_version),
  CHECK (candidate_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (observation_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS formweave_semantic_candidates_artifact_idx
  ON formweave_semantic_candidates (artifact_id, candidate_version DESC);

CREATE TABLE IF NOT EXISTS formweave_actuator_bundles (
  bundle_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  bundle_version integer NOT NULL CHECK (bundle_version > 0),
  semantic_candidate_id text NOT NULL
    REFERENCES formweave_semantic_candidates(candidate_id),
  semantic_candidate_sha256 character(64) NOT NULL,
  observation_sha256 character(64) NOT NULL,
  bundle_sha256 character(64) NOT NULL,
  status text NOT NULL CHECK (
    status IN ('draft', 'rejected', 'validated', 'superseded')
  ),
  manifest jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, bundle_version),
  CHECK (semantic_candidate_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (observation_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS formweave_actuator_bundles_artifact_idx
  ON formweave_actuator_bundles (artifact_id, bundle_version DESC);

CREATE TABLE IF NOT EXISTS formweave_actuator_modules (
  bundle_id text NOT NULL
    REFERENCES formweave_actuator_bundles(bundle_id) ON DELETE RESTRICT,
  module_path text NOT NULL,
  source_sha256 character(64) NOT NULL,
  source_text text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bundle_id, module_path),
  CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (length(source_text) > 0)
);

CREATE TABLE IF NOT EXISTS formweave_repair_attempts (
  repair_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  layer text NOT NULL CHECK (layer IN ('semantic', 'actuator', 'both')),
  base_semantic_sha256 character(64),
  base_actuator_sha256 character(64),
  issue_ids jsonb NOT NULL,
  repair_document jsonb NOT NULL,
  status text NOT NULL CHECK (
    status IN ('proposed', 'rejected', 'applied', 'superseded')
  ),
  model_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    base_semantic_sha256 IS NULL OR
    base_semantic_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CHECK (
    base_actuator_sha256 IS NULL OR
    base_actuator_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS formweave_repair_attempts_artifact_idx
  ON formweave_repair_attempts (artifact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS formweave_validation_runs (
  validation_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  semantic_candidate_id text
    REFERENCES formweave_semantic_candidates(candidate_id),
  actuator_bundle_id text
    REFERENCES formweave_actuator_bundles(bundle_id),
  phase text NOT NULL CHECK (
    phase IN ('semantic', 'actuator_static', 'preflight', 'publication')
  ),
  outcome text NOT NULL CHECK (outcome IN ('passed', 'failed', 'blocked')),
  validator_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  timings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS formweave_validation_runs_artifact_idx
  ON formweave_validation_runs (artifact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS formweave_artifact_releases (
  release_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  release_version integer NOT NULL CHECK (release_version > 0),
  semantic_candidate_id text NOT NULL
    REFERENCES formweave_semantic_candidates(candidate_id),
  semantic_version integer NOT NULL CHECK (semantic_version > 0),
  semantic_sha256 character(64) NOT NULL,
  actuator_bundle_id text NOT NULL
    REFERENCES formweave_actuator_bundles(bundle_id),
  actuator_version integer NOT NULL CHECK (actuator_version > 0),
  actuator_sha256 character(64) NOT NULL,
  validation_ids jsonb NOT NULL,
  supersedes_release_id text REFERENCES formweave_artifact_releases(release_id),
  certification_status text NOT NULL CHECK (
    certification_status IN ('observed', 'certified', 'revoked', 'superseded')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, release_version),
  CHECK (semantic_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (actuator_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS formweave_artifact_release_heads (
  artifact_id text PRIMARY KEY,
  release_id text NOT NULL REFERENCES formweave_artifact_releases(release_id),
  release_version integer NOT NULL CHECK (release_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS formweave_semantic_candidates_immutable
  ON formweave_semantic_candidates;
CREATE TRIGGER formweave_semantic_candidates_immutable
BEFORE UPDATE OR DELETE ON formweave_semantic_candidates
FOR EACH ROW EXECUTE FUNCTION formweave_reject_immutable_change();

DROP TRIGGER IF EXISTS formweave_actuator_bundles_immutable
  ON formweave_actuator_bundles;
CREATE TRIGGER formweave_actuator_bundles_immutable
BEFORE UPDATE OR DELETE ON formweave_actuator_bundles
FOR EACH ROW EXECUTE FUNCTION formweave_reject_immutable_change();

DROP TRIGGER IF EXISTS formweave_actuator_modules_immutable
  ON formweave_actuator_modules;
CREATE TRIGGER formweave_actuator_modules_immutable
BEFORE UPDATE OR DELETE ON formweave_actuator_modules
FOR EACH ROW EXECUTE FUNCTION formweave_reject_immutable_change();

DROP TRIGGER IF EXISTS formweave_repair_attempts_immutable
  ON formweave_repair_attempts;
CREATE TRIGGER formweave_repair_attempts_immutable
BEFORE UPDATE OR DELETE ON formweave_repair_attempts
FOR EACH ROW EXECUTE FUNCTION formweave_reject_immutable_change();

DROP TRIGGER IF EXISTS formweave_validation_runs_immutable
  ON formweave_validation_runs;
CREATE TRIGGER formweave_validation_runs_immutable
BEFORE UPDATE OR DELETE ON formweave_validation_runs
FOR EACH ROW EXECUTE FUNCTION formweave_reject_immutable_change();

DROP TRIGGER IF EXISTS formweave_artifact_releases_immutable
  ON formweave_artifact_releases;
CREATE TRIGGER formweave_artifact_releases_immutable
BEFORE UPDATE OR DELETE ON formweave_artifact_releases
FOR EACH ROW EXECUTE FUNCTION formweave_reject_immutable_change();

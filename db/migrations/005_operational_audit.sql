CREATE TABLE IF NOT EXISTS formweave_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL CHECK (
    category IN ('authentication', 'api', 'crawl', 'approval', 'execution')
  ),
  severity text NOT NULL CHECK (
    severity IN ('info', 'success', 'warning', 'error')
  ),
  event_type text NOT NULL,
  outcome text NOT NULL,
  actor_type text NOT NULL CHECK (
    actor_type IN ('user', 'api_token', 'local', 'system', 'unknown')
  ),
  actor_id text,
  scope_type text,
  scope_id text,
  parent_scope_type text,
  parent_scope_id text,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS formweave_audit_events_occurred_idx
  ON formweave_audit_events (occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS formweave_audit_events_category_idx
  ON formweave_audit_events (category, occurred_at DESC);

CREATE INDEX IF NOT EXISTS formweave_audit_events_actor_idx
  ON formweave_audit_events (actor_type, actor_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS formweave_audit_events_scope_idx
  ON formweave_audit_events (scope_type, scope_id, occurred_at DESC);

DROP TRIGGER IF EXISTS formweave_audit_events_immutable
  ON formweave_audit_events;
CREATE TRIGGER formweave_audit_events_immutable
BEFORE UPDATE OR DELETE ON formweave_audit_events
FOR EACH ROW EXECUTE FUNCTION formweave_reject_immutable_change();

ALTER TABLE formweave_audit_events
  DROP CONSTRAINT IF EXISTS formweave_audit_events_category_check;

ALTER TABLE formweave_audit_events
  ADD CONSTRAINT formweave_audit_events_category_check
  CHECK (
    category IN (
      'authentication',
      'api',
      'crawl',
      'approval',
      'execution',
      'llm'
    )
  );

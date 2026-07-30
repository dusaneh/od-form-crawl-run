CREATE TABLE IF NOT EXISTS formweave_users (
  email text PRIMARY KEY,
  display_name text NOT NULL,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  password_parameters jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email)),
  CHECK (password_salt ~ '^[A-Za-z0-9_-]+$'),
  CHECK (password_hash ~ '^[A-Za-z0-9_-]+$')
);

CREATE TABLE IF NOT EXISTS formweave_api_tokens (
  token_id text PRIMARY KEY,
  label text NOT NULL,
  token_prefix text NOT NULL,
  token_hash character(64) NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['api']::text[],
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS formweave_auth_failures (
  principal_hash character(64) PRIMARY KEY,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (principal_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS formweave_auth_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL CHECK (
    event_type IN (
      'basic_success',
      'basic_failure',
      'bearer_success',
      'bearer_failure',
      'principal_locked'
    )
  ),
  principal_hash character(64),
  client_hash character(64),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS formweave_auth_events_occurred_at_idx
  ON formweave_auth_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS formweave_api_tokens_prefix_idx
  ON formweave_api_tokens (token_prefix);

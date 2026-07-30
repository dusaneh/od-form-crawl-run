CREATE TABLE IF NOT EXISTS formweave_auth_sessions (
  session_hash character(64) PRIMARY KEY,
  user_email text NOT NULL REFERENCES formweave_users(email) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS formweave_auth_sessions_user_idx
  ON formweave_auth_sessions (user_email, expires_at DESC);

CREATE INDEX IF NOT EXISTS formweave_auth_sessions_expiry_idx
  ON formweave_auth_sessions (expires_at);

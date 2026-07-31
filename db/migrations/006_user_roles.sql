ALTER TABLE formweave_users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'operator';

ALTER TABLE formweave_users
  DROP CONSTRAINT IF EXISTS formweave_users_role_check;

ALTER TABLE formweave_users
  ADD CONSTRAINT formweave_users_role_check
  CHECK (role IN ('operator', 'admin'));

UPDATE formweave_users
SET role = CASE
  WHEN email = 'dbosmail@gmail.com' THEN 'admin'
  ELSE 'operator'
END;

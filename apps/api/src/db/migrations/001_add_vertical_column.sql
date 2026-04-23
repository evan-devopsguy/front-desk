BEGIN;
ALTER TABLE tenants
  ADD COLUMN vertical TEXT NOT NULL DEFAULT 'medspa'
  CHECK (vertical IN ('medspa','garage-doors'));
ALTER TABLE tenants
  ALTER COLUMN vertical DROP DEFAULT;
COMMIT;

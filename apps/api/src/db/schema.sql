-- ============================================================================
-- MedSpa AI Receptionist — core schema
-- Runs on first boot via docker-entrypoint-initdb.d. Idempotent.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ---------------------------------------------------------------------------
-- Application role. The API connects as this role so Row-Level Security
-- actually applies (superusers bypass RLS).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medspa_app') THEN
    CREATE ROLE medspa_app LOGIN PASSWORD 'medspa_app';
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  twilio_number TEXT UNIQUE NOT NULL,
  booking_adapter TEXT NOT NULL DEFAULT 'mock'
    CHECK (booking_adapter IN ('mock','boulevard','vagaro')),
  booking_credentials_secret_arn TEXT,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms','voice','ig')),
  patient_phone_hash TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('active','booked','escalated','abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS conversations_tenant_phone_idx
  ON conversations (tenant_id, patient_phone_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('patient','assistant','system','tool')),
  content TEXT NOT NULL,
  tool_calls JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  external_booking_id TEXT,
  service TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  patient_name TEXT NOT NULL,
  patient_phone_hash TEXT NOT NULL,
  estimated_value_cents INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bookings_tenant_scheduled_idx
  ON bookings (tenant_id, scheduled_at);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding VECTOR(1024),
  source_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS knowledge_chunks_tenant_idx
  ON knowledge_chunks (tenant_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_time_idx
  ON audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx
  ON audit_log (action, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row-Level Security
--
-- Every PHI-bearing table enforces: current_setting('app.tenant_id') matches
-- the row's tenant_id. The API wraps each request in a transaction that SETs
-- this GUC. A missing/invalid GUC denies all rows — fail-closed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
DECLARE
  v TEXT := current_setting('app.tenant_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RETURN NULL;
  END IF;
  RETURN v::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- RLS is enforced on every PHI-bearing table. `tenants` is intentionally
-- NOT in this list: it holds spa metadata + Twilio number for inbound
-- routing (not PHI), and RLS on tenants would create a bootstrap
-- impossibility (the inbound SMS webhook needs to look up a tenant by
-- Twilio number before it has a tenant context).
DO $$
DECLARE
  t TEXT;
  phi_tables TEXT[] := ARRAY[
    'conversations','messages','bookings','knowledge_chunks'
  ];
BEGIN
  FOREACH t IN ARRAY phi_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id())
    $p$, t);
  END LOOP;
END$$;

-- audit_log: writes are allowed from any tenant context, reads are tenant-scoped
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_tenant_read ON audit_log;
CREATE POLICY audit_tenant_read ON audit_log
  FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
DROP POLICY IF EXISTS audit_tenant_write ON audit_log;
CREATE POLICY audit_tenant_write ON audit_log
  FOR INSERT
  WITH CHECK (tenant_id IS NULL OR tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- Auto-audit trigger: any INSERT/UPDATE/DELETE on PHI tables writes an
-- audit_log row. This is the "enforce via DB trigger, not discipline" rule.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION log_phi_change() RETURNS TRIGGER AS $$
DECLARE
  v_tenant UUID;
  v_resource UUID;
  v_action TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant := COALESCE((OLD).tenant_id, (OLD).id);
    v_resource := (OLD).id;
    v_action := TG_TABLE_NAME || '_deleted';
  ELSIF TG_OP = 'UPDATE' THEN
    v_tenant := COALESCE((NEW).tenant_id, (NEW).id);
    v_resource := (NEW).id;
    v_action := TG_TABLE_NAME || '_updated';
  ELSE
    v_tenant := COALESCE((NEW).tenant_id, (NEW).id);
    v_resource := (NEW).id;
    v_action := TG_TABLE_NAME || '_created';
  END IF;

  INSERT INTO audit_log (tenant_id, actor, action, resource_type, resource_id, metadata)
  VALUES (
    v_tenant,
    COALESCE(current_setting('app.actor', true), 'system'),
    v_action,
    TG_TABLE_NAME,
    v_resource,
    jsonb_build_object('op', TG_OP)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- NB: we don't audit SELECTs at row level (too chatty). Read audits are
-- emitted by the application layer via lib/audit.ts.
DO $$
DECLARE
  t TEXT;
  phi_tables TEXT[] := ARRAY[
    'conversations','messages','bookings','knowledge_chunks'
  ];
BEGIN
  FOREACH t IN ARRAY phi_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_audit ON %I', t, t);
    EXECUTE format($p$
      CREATE TRIGGER %I_audit
      AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION log_phi_change()
    $p$, t, t);
  END LOOP;
END$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO medspa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO medspa_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO medspa_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO medspa_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO medspa_app;

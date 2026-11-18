-- Integrity rules that Prisma's schema language cannot express (SPEC §7, PLAN D1).

-- ONU uniqueness only among active rows: archived/removed rows keep their history.
CREATE UNIQUE INDEX "onu_active_position_key" ON "onu" ("olt_id", "pon_port_id", "onu_index")
  WHERE "archived_at" IS NULL AND "removed_at" IS NULL;
CREATE UNIQUE INDEX "onu_active_sn_key" ON "onu" ("olt_id", "sn")
  WHERE "archived_at" IS NULL AND "removed_at" IS NULL;

-- olt.is_mock can never change after insert: write guards rely on it.
CREATE FUNCTION "olt_is_mock_immutable"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."is_mock" IS DISTINCT FROM OLD."is_mock" THEN
    RAISE EXCEPTION 'olt.is_mock is immutable (olt %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "olt_is_mock_immutable"
  BEFORE UPDATE OF "is_mock" ON "olt"
  FOR EACH ROW EXECUTE FUNCTION "olt_is_mock_immutable"();

-- Application role: full DML except UPDATE/DELETE/TRUNCATE on audit_log (append-only).
-- NOLOGIN: the runtime login user is created at deploy time and granted `app`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE "app" NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO "app";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "app";
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM "app";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "app";

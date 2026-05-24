-- Read-only Postgres role for the MCP `run_sql` tool (DATABASE_URL_RO).
--
-- This is the hard backstop of run_sql's defense-in-depth model: the role has
-- only SELECT, so even a validator miss cannot write. Idempotent — safe to
-- re-run.
--
-- Manual use against an existing database:
--   psql "$DATABASE_URL" -v ro_password='<choose-a-password>' \
--     -f scripts/create-ro-role.sql
--
-- Docker Compose runs this automatically on first DB init via
-- scripts/init-ro-role.sh. Kept OUT of Prisma migrations on purpose:
-- migrations run as the app role and manage schema, not cluster roles.

\set ON_ERROR_STOP on

DO $ht$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'house_track_ro') THEN
    EXECUTE format('CREATE ROLE house_track_ro LOGIN PASSWORD %L', :'ro_password');
  ELSE
    EXECUTE format('ALTER ROLE house_track_ro LOGIN PASSWORD %L', :'ro_password');
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO house_track_ro', current_database());
END
$ht$;

GRANT USAGE ON SCHEMA public TO house_track_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO house_track_ro;
-- Cover tables created by future migrations, too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO house_track_ro;

-- Session-level guards, inherited by every connection from this role.
ALTER ROLE house_track_ro SET default_transaction_read_only = on;
ALTER ROLE house_track_ro SET statement_timeout = '5s';

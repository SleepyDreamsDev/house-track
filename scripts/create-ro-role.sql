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

-- Fail closed: a missing or empty ro_password would otherwise create the role
-- with a blank password. Print a hint when it's missing, then abort on empty
-- via a runtime division-by-zero (ON_ERROR_STOP turns it into a non-zero exit).
\if :{?ro_password}
\else
  \echo 'ERROR: create-ro-role.sql requires -v ro_password=<password>'
  \set ro_password ''
\endif
SELECT 1 / (CASE WHEN :'ro_password' = '' THEN 0 ELSE 1 END) AS _require_ro_password;

-- Create the role only if it doesn't exist (idempotent). psql variables are not
-- interpolated inside DO $$…$$ blocks, so we drive the conditional CREATE with
-- \gexec and set the password in a plain ALTER where :'ro_password' expands.
SELECT 'CREATE ROLE house_track_ro LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'house_track_ro')
\gexec

ALTER ROLE house_track_ro LOGIN PASSWORD :'ro_password';

-- current_database() isn't a constant, so build the GRANT and \gexec it.
SELECT format('GRANT CONNECT ON DATABASE %I TO house_track_ro', current_database())
\gexec

GRANT USAGE ON SCHEMA public TO house_track_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO house_track_ro;
-- Cover tables created by future migrations, too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO house_track_ro;

-- Session-level guards, inherited by every connection from this role.
ALTER ROLE house_track_ro SET default_transaction_read_only = on;
ALTER ROLE house_track_ro SET statement_timeout = '5s';

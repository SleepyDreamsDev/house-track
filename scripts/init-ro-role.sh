#!/bin/sh
# Docker initdb hook: create the read-only role for the MCP run_sql tool.
# Runs once, on first database initialization (empty data volume). For an
# existing database, run scripts/create-ro-role.sql by hand instead.
set -eu

if [ -z "${RO_PASSWORD:-}" ]; then
  echo "ERROR: RO_PASSWORD must be set to create the read-only MCP role." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v ro_password="$RO_PASSWORD" \
  -f /opt/house-track/create-ro-role.sql

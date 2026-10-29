#!/bin/bash
# Creates the isolated SCRATCH database "e2e" on the sandbox Postgres (port 5499) with the stubbed prerequisites and the PROPOSED migration 104 applied.
# Not Supabase. Nothing here touches any real database.
set -e
P="psql -h /var/run/postgresql -p 5499 -U postgres -v ON_ERROR_STOP=1 -q"
bash /tmp/pgup.sh
su postgres -c "$P -d postgres -c 'DROP DATABASE IF EXISTS e2e' -c 'CREATE DATABASE e2e'" 2>/dev/null || $P -d postgres -c 'DROP DATABASE IF EXISTS e2e' -c 'CREATE DATABASE e2e'
cd "$(dirname "$0")"
$P -d e2e -f /tmp/m1_prereq.sql >/dev/null
$P -d e2e -c "ALTER TABLE holes ADD COLUMN par int DEFAULT 4; ALTER TABLE trip_members ADD COLUMN group_id uuid" >/dev/null
$P -d e2e -f ../../package4-m1/PROPOSED_104_competition_teams.sql >/dev/null
$P -d e2e -f seed.sql >/dev/null
echo "e2e scratch database ready"

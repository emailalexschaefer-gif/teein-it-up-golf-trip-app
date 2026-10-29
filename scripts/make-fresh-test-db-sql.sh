#!/bin/bash
# Builds ONE SQL file that creates the whole application schema in a brand-new, EMPTY Supabase project (a throwaway test project).
# NEVER run the output against production. It replays history in filename order (C locale), skipping 000_combined_fresh_database.sql
# (an alternative to 001-006). Expect exactly one harmless error from 086_moments_video_support.sql on a fresh database (it names the column
# duration_seconds before adding it; migration 089 repairs it and the end state is correct). Migration 104 is NOT included: apply it separately.
#   usage:  bash scripts/make-fresh-test-db-sql.sh > fresh_test_db_001_103.sql
#           psql "$TEST_PROJECT_DB_URL" -f fresh_test_db_001_103.sql        (no -v ON_ERROR_STOP, so the 086 message does not abort)
set -e
cd "$(dirname "$0")/.."
export LC_ALL=C
echo "-- GENERATED $(date -u +%F) -- FRESH THROWAWAY TEST DATABASE ONLY. NEVER RUN AGAINST PRODUCTION."
for f in $(ls supabase/migrations/*.sql | grep -v '/000_' | sort); do
  echo ""; echo "-- ===== BEGIN $(basename "$f") ====="; cat "$f"; echo ""; echo "-- ===== END $(basename "$f") ====="
done
